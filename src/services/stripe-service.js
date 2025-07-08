// src/services/stripe-service.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { logger } = require('../config/logger');

class StripeService {
  constructor() {
    // Validate Stripe credentials
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('Missing Stripe configuration');
    }

    this.stripe = stripe;
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  }

  /**
   * Create a Stripe customer
   * @param {Object} customerData - Customer information
   * @returns {Promise} Stripe customer object
   */
  async createCustomer(customerData) {
    try {
      logger.info('Creating Stripe customer', { email: customerData.email });
      
      const customer = await this.stripe.customers.create({
        email: customerData.email,
        name: `${customerData.firstName} ${customerData.lastName}`,
        phone: customerData.phoneNumber,
        metadata: {
          firebaseUid: customerData.firebaseUid,
          organizationId: customerData.organizationId,
          organizationName: customerData.organizationName
        }
      });

      logger.info('Stripe customer created', { 
        customerId: customer.id, 
        email: customer.email 
      });
      
      return customer;
    } catch (error) {
      logger.error('Failed to create Stripe customer', { 
        error: error.message,
        email: customerData.email 
      });
      throw error;
    }
  }

  /**
   * Create a checkout session
   * @param {Object} sessionData - Checkout session data
   * @returns {Promise} Stripe checkout session
   */
  async createCheckoutSession(sessionData) {
    try {
      logger.info('Creating checkout session', { 
        priceId: sessionData.priceId,
        customerId: sessionData.customerId 
      });

      const session = await this.stripe.checkout.sessions.create({
        customer: sessionData.customerId,
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [
          {
            price: sessionData.priceId,
            quantity: 1,
          },
        ],
        success_url: sessionData.successUrl,
        cancel_url: sessionData.cancelUrl,
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        metadata: {
          firebaseUid: sessionData.firebaseUid,
          organizationId: sessionData.organizationId,
          planType: sessionData.planType
        }
      });

      logger.info('Checkout session created', { 
        sessionId: session.id,
        url: session.url 
      });
      
      return session;
    } catch (error) {
      logger.error('Failed to create checkout session', { 
        error: error.message,
        priceId: sessionData.priceId 
      });
      throw error;
    }
  }

  /**
   * Create a customer portal session
   * @param {string} customerId - Stripe customer ID
   * @param {string} returnUrl - URL to return to after portal session
   * @returns {Promise} Portal session
   */
  async createPortalSession(customerId, returnUrl) {
    try {
      logger.info('Creating customer portal session', { customerId });

      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      logger.info('Portal session created', { 
        sessionId: session.id,
        url: session.url 
      });
      
      return session;
    } catch (error) {
      logger.error('Failed to create portal session', { 
        error: error.message,
        customerId 
      });
      throw error;
    }
  }

  /**
   * Cancel a subscription
   * @param {string} subscriptionId - Stripe subscription ID
   * @returns {Promise} Cancelled subscription
   */
  async cancelSubscription(subscriptionId) {
    try {
      logger.info('Cancelling subscription', { subscriptionId });

      const subscription = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });

      logger.info('Subscription cancelled', { 
        subscriptionId: subscription.id,
        cancelAtPeriodEnd: subscription.cancel_at_period_end 
      });
      
      return subscription;
    } catch (error) {
      logger.error('Failed to cancel subscription', { 
        error: error.message,
        subscriptionId 
      });
      throw error;
    }
  }

  /**
   * Update a subscription
   * @param {string} subscriptionId - Stripe subscription ID
   * @param {string} newPriceId - New price ID
   * @returns {Promise} Updated subscription
   */
  async updateSubscription(subscriptionId, newPriceId) {
    try {
      logger.info('Updating subscription', { subscriptionId, newPriceId });

      // Get the subscription to find the current subscription item
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      
      const updatedSubscription = await this.stripe.subscriptions.update(subscriptionId, {
        items: [{
          id: subscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: 'create_prorations',
      });

      logger.info('Subscription updated', { 
        subscriptionId: updatedSubscription.id,
        newPriceId 
      });
      
      return updatedSubscription;
    } catch (error) {
      logger.error('Failed to update subscription', { 
        error: error.message,
        subscriptionId,
        newPriceId 
      });
      throw error;
    }
  }

  /**
   * Get customer by ID
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise} Customer object
   */
  async getCustomer(customerId) {
    try {
      return await this.stripe.customers.retrieve(customerId);
    } catch (error) {
      logger.error('Failed to get customer', { 
        error: error.message,
        customerId 
      });
      throw error;
    }
  }

  /**
   * Get subscription by ID
   * @param {string} subscriptionId - Stripe subscription ID
   * @returns {Promise} Subscription object
   */
  async getSubscription(subscriptionId) {
    try {
      return await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      logger.error('Failed to get subscription', { 
        error: error.message,
        subscriptionId 
      });
      throw error;
    }
  }

  /**
   * Handle Stripe webhook
   * @param {string} body - Raw webhook body
   * @param {string} signature - Stripe signature header
   * @returns {Promise} Webhook event
   */
  async handleWebhook(body, signature) {
    try {
      const event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        this.webhookSecret
      );

      logger.info('Webhook received', { 
        type: event.type,
        id: event.id 
      });

      return event;
    } catch (error) {
      logger.error('Webhook signature verification failed', { 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * List all prices for a product
   * @param {string} productId - Stripe product ID
   * @returns {Promise} List of prices
   */
  async getProductPrices(productId) {
    try {
      const prices = await this.stripe.prices.list({
        product: productId,
        active: true,
      });

      return prices.data;
    } catch (error) {
      logger.error('Failed to get product prices', { 
        error: error.message,
        productId 
      });
      throw error;
    }
  }

  /**
   * Create a usage record for metered billing
   * @param {string} subscriptionItemId - Subscription item ID
   * @param {number} quantity - Usage quantity
   * @returns {Promise} Usage record
   */
  async createUsageRecord(subscriptionItemId, quantity) {
    try {
      logger.info('Creating usage record', { subscriptionItemId, quantity });

      const usageRecord = await this.stripe.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        {
          quantity,
          timestamp: Math.floor(Date.now() / 1000),
        }
      );

      logger.info('Usage record created', { 
        usageRecordId: usageRecord.id,
        quantity 
      });
      
      return usageRecord;
    } catch (error) {
      logger.error('Failed to create usage record', { 
        error: error.message,
        subscriptionItemId,
        quantity 
      });
      throw error;
    }
  }
}

module.exports = new StripeService();
