// src/routes/stripe-routes.js
const express = require('express');
const stripeService = require('../services/stripe-service');
const { logger } = require('../config/logger');
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  try {
    // Use environment variables for Firebase Admin
    if (process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
      logger.info('✅ Firebase Admin initialized with environment variables');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      logger.info('✅ Firebase Admin initialized with service account file');
    } else {
      throw new Error('Firebase Admin credentials not configured');
    }
  } catch (error) {
    logger.error('❌ Failed to initialize Firebase Admin', { error: error.message });
    throw error;
  }
}

const db = admin.firestore();

/**
 * Middleware to verify Firebase token
 */
async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No valid authorization header' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    logger.error('Firebase token verification failed', { error: error.message });
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = (app) => {
  // Create checkout session
  app.post('/api/stripe/create-checkout-session', verifyFirebaseToken, async (req, res) => {
    try {
      const { priceId, successUrl, cancelUrl } = req.body;
      const firebaseUid = req.user.uid;

      logger.info('Creating checkout session', { firebaseUid, priceId });

      // Get user data from Firestore
      const userDoc = await db.collection('users').doc(firebaseUid).get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userData = userDoc.data();
      const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
      
      if (!orgDoc.exists) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      
      const orgData = orgDoc.data();

      // Check if customer already exists in Stripe
      let customerId = orgData.stripeCustomerId;
      
      if (!customerId) {
        // Create new Stripe customer
        const customer = await stripeService.createCustomer({
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          phoneNumber: userData.phoneNumber,
          firebaseUid: firebaseUid,
          organizationId: userData.organizationId,
          organizationName: orgData.name
        });
        
        customerId = customer.id;
        
        // Save customer ID to Firestore
        await db.collection('organizations').doc(userData.organizationId).update({
          stripeCustomerId: customerId
        });
      }

      // Create checkout session
      const session = await stripeService.createCheckoutSession({
        priceId,
        customerId,
        successUrl,
        cancelUrl,
        firebaseUid,
        organizationId: userData.organizationId,
        planType: determinePlanType(priceId)
      });

      res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
      logger.error('Failed to create checkout session', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Create customer portal session
  app.post('/api/stripe/create-portal-session', verifyFirebaseToken, async (req, res) => {
    try {
      const firebaseUid = req.user.uid;

      // Get user data from Firestore
      const userDoc = await db.collection('users').doc(firebaseUid).get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userData = userDoc.data();
      const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
      const orgData = orgDoc.data();

      if (!orgData.stripeCustomerId) {
        return res.status(400).json({ error: 'No Stripe customer found' });
      }

      // Create portal session
      const session = await stripeService.createPortalSession(
        orgData.stripeCustomerId,
        `https://kitchen.heysalad.app/dashboard/billing`
      );

      res.json({ url: session.url });
    } catch (error) {
      logger.error('Failed to create portal session', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel subscription
  app.post('/api/stripe/cancel-subscription', verifyFirebaseToken, async (req, res) => {
    try {
      const { subscriptionId } = req.body;
      const firebaseUid = req.user.uid;

      // Verify user owns this subscription
      const userDoc = await db.collection('users').doc(firebaseUid).get();
      const userData = userDoc.data();
      const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
      const orgData = orgDoc.data();

      if (orgData.stripeSubscriptionId !== subscriptionId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const subscription = await stripeService.cancelSubscription(subscriptionId);
      
      res.json({ success: true, subscription });
    } catch (error) {
      logger.error('Failed to cancel subscription', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Update subscription
  app.post('/api/stripe/update-subscription', verifyFirebaseToken, async (req, res) => {
    try {
      const { subscriptionId, newPriceId } = req.body;
      const firebaseUid = req.user.uid;

      // Verify user owns this subscription
      const userDoc = await db.collection('users').doc(firebaseUid).get();
      const userData = userDoc.data();
      const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
      const orgData = orgDoc.data();

      if (orgData.stripeSubscriptionId !== subscriptionId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const subscription = await stripeService.updateSubscription(subscriptionId, newPriceId);
      
      res.json({ success: true, subscription });
    } catch (error) {
      logger.error('Failed to update subscription', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Stripe webhooks
  app.post('/api/stripe/webhook', async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'];
      const event = await stripeService.handleWebhook(req.body, signature);

      logger.info('Processing webhook event', { type: event.type, id: event.id });

      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object);
          break;
          
        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object);
          break;
          
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object);
          break;
          
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object);
          break;
          
        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object);
          break;
          
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;
          
        default:
          logger.info('Unhandled webhook event', { type: event.type });
      }

      res.json({ received: true });
    } catch (error) {
      logger.error('Webhook processing failed', { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  // Get subscription status
  app.get('/api/stripe/subscription-status', verifyFirebaseToken, async (req, res) => {
    try {
      const firebaseUid = req.user.uid;

      // Get user data from Firestore
      const userDoc = await db.collection('users').doc(firebaseUid).get();
      const userData = userDoc.data();
      const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
      const orgData = orgDoc.data();

      if (!orgData.stripeSubscriptionId) {
        return res.json({ hasSubscription: false });
      }

      const subscription = await stripeService.getSubscription(orgData.stripeSubscriptionId);
      
      res.json({
        hasSubscription: true,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          priceId: subscription.items.data[0].price.id,
          amount: subscription.items.data[0].price.unit_amount,
          currency: subscription.items.data[0].price.currency,
          interval: subscription.items.data[0].price.recurring.interval
        }
      });
    } catch (error) {
      logger.error('Failed to get subscription status', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });
};

// Helper function to determine plan type from price ID
function determinePlanType(priceId) {
  // Map your actual Stripe price IDs to plan types
  const priceIdMap = {
    'price_1ReyIZEANO5VU5U28Fix0mow': 'STARTER',      // Starter Monthly
    'price_1ReyGBEANO5VU5U20mE8ivz9': 'STARTER',      // Starter Yearly
    'price_1ReyLUEANO5VU5U2NeoIkE7R': 'PROFESSIONAL', // Professional Monthly
    'price_1ReyMpEANO5VU5U2q4NQrubW': 'PROFESSIONAL', // Professional Yearly
    'price_1ReyQkEANO5VU5U2QXwMXfP5': 'ENTERPRISE',   // Enterprise Monthly
    'price_1ReyV9EANO5VU5U2TzU9dI47': 'ENTERPRISE'    // Enterprise Yearly
  };
  
  return priceIdMap[priceId] || 'UNKNOWN';
}

// Webhook event handlers
async function handleCheckoutCompleted(session) {
  try {
    logger.info('Checkout session completed', { sessionId: session.id });
    
    // Update organization with subscription info
    const firebaseUid = session.metadata.firebaseUid;
    const organizationId = session.metadata.organizationId;
    
    if (firebaseUid && organizationId) {
      await db.collection('organizations').doc(organizationId).update({
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        subscription: determinePlanType(session.metadata.planType) || 'PROFESSIONAL',
        'billingInfo.status': 'ACTIVE',
        'billingInfo.plan': determinePlanType(session.metadata.planType) || 'PROFESSIONAL',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      logger.info('Organization updated after successful checkout', { organizationId });
    }
  } catch (error) {
    logger.error('Failed to handle checkout completed', { error: error.message });
  }
}

async function handleSubscriptionCreated(subscription) {
  try {
    logger.info('Subscription created', { subscriptionId: subscription.id });
    
    // Additional logic for subscription creation
  } catch (error) {
    logger.error('Failed to handle subscription created', { error: error.message });
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    logger.info('Subscription updated', { subscriptionId: subscription.id });
    
    // Update organization billing info
    const customer = await stripeService.getCustomer(subscription.customer);
    const organizationId = customer.metadata.organizationId;
    
    if (organizationId) {
      const updateData = {
        'billingInfo.status': subscription.status.toUpperCase(),
        'billingInfo.currentPeriodStart': new Date(subscription.current_period_start * 1000),
        'billingInfo.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
        'billingInfo.cancelAtPeriodEnd': subscription.cancel_at_period_end,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection('organizations').doc(organizationId).update(updateData);
    }
  } catch (error) {
    logger.error('Failed to handle subscription updated', { error: error.message });
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    logger.info('Subscription deleted', { subscriptionId: subscription.id });
    
    // Update organization to trial or inactive
    const customer = await stripeService.getCustomer(subscription.customer);
    const organizationId = customer.metadata.organizationId;
    
    if (organizationId) {
      await db.collection('organizations').doc(organizationId).update({
        subscription: 'TRIAL', // or 'INACTIVE'
        'billingInfo.status': 'CANCELED',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    logger.error('Failed to handle subscription deleted', { error: error.message });
  }
}

async function handlePaymentSucceeded(invoice) {
  try {
    logger.info('Payment succeeded', { invoiceId: invoice.id });
    
    // Update billing info, send confirmation email, etc.
  } catch (error) {
    logger.error('Failed to handle payment succeeded', { error: error.message });
  }
}

async function handlePaymentFailed(invoice) {
  try {
    logger.error('Payment failed', { invoiceId: invoice.id });
    
    // Send notification email, update billing status, etc.
  } catch (error) {
    logger.error('Failed to handle payment failed', { error: error.message });
  }
}
