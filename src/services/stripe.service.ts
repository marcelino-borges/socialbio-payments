import Stripe from "stripe";
import stripe, { initializeStripe } from "../config/stripe";
import { AppErrorsMessages } from "../constants";
import AppResult from "../errors/app-error";
import { IUser, PlansTypes } from "../models/user.models";
import { Request, Response } from "express";
import SubscriptionsDB, {
  IPaymentIntent,
  ISubscriptionCreationResult,
  SubscriptionStatus,
} from "../models/subscription.models";
import log from "./../utils/logs";
import { getPriceIdByRecurrencyAndPlanType } from "../utils/stripe";
import { handlePaymentIntent } from "./webhooks/payment-intent.service";
import { handleInvoice } from "./webhooks/invoice.service";

let stripeInstance: Stripe | null = stripe;

export const createCustomer = async (
  user: IUser
): Promise<Stripe.Customer | null> => {
  if (!stripeInstance) stripeInstance = await initializeStripe();

  if (!stripeInstance) return null;

  const params: Stripe.CustomerCreateParams = {
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    metadata: {
      authId: user.authId || null,
      userId: user._id?.toString() || null,
    },
  };

  const customer: Stripe.Customer = await stripeInstance.customers.create(
    params
  );

  if (customer) return customer;
  return null;
};

export const assureStripeCustomerCreated = async (
  user: IUser
): Promise<IUser> => {
  if (!stripeInstance) stripeInstance = await initializeStripe();

  if (!stripeInstance)
    throw new Error(AppErrorsMessages.INVALID_PAYMENT_INSTANCE);

  if (user.paymentId) {
    return user;
  }

  const customer: Stripe.Customer | null = await createCustomer(user);

  if (!customer)
    throw new Error(AppErrorsMessages.PAYMENT_CUSTOMER_NOT_CREATED);

  return {
    ...user,
    paymentId: customer.id,
  };
};

export const getSubsctriptionPaymentIntent = async (
  paymentIntentId: string
) => {
  if (!stripeInstance) stripeInstance = await initializeStripe();

  if (!stripeInstance) return null;

  if (!paymentIntentId) {
    return null;
  }

  const paymentIntent = stripeInstance.paymentIntents.retrieve(paymentIntentId);

  if (!paymentIntent) {
    return null;
  }
  return paymentIntent;
};

export const createSubscriptionOnStripe = async (
  paymentId: string,
  currency: string,
  recurrency: "month" | "year",
  planType: PlansTypes
) => {
  if (!stripeInstance) stripeInstance = await initializeStripe();

  if (!stripeInstance) return null;

  if (!paymentId) {
    return null;
  }

  const priceId = getPriceIdByRecurrencyAndPlanType(recurrency, planType);

  if (!priceId) {
    return null;
  }

  const subscription = stripeInstance.subscriptions.create({
    customer: paymentId,
    items: [
      {
        price: priceId,
      },
    ],
    cancel_at_period_end: true,
    currency,
    collection_method: "charge_automatically",
    payment_settings: { save_default_payment_method: "on_subscription" },
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
  });

  if (!subscription) {
    return null;
  }
  return subscription;
};

export const cancelSubscriptionOnStripe = async (subscriptionId: string) => {
  if (!stripeInstance) stripeInstance = await initializeStripe();

  if (!stripeInstance) return null;

  const subscriptionUpdated = await SubscriptionsDB.findOneAndUpdate(
    {
      subscriptionId,
    },
    {
      status: SubscriptionStatus.canceled,
    },
    {
      new: true,
    }
  );

  if (!subscriptionUpdated) {
    return null;
  }

  const subscription = stripeInstance.subscriptions.del(subscriptionId);

  if (!subscription) {
    return null;
  }

  return subscriptionUpdated;
};

export const saveSubscriptionResult = async (
  subscription: ISubscriptionCreationResult
): Promise<ISubscriptionCreationResult> => {
  return (
    await SubscriptionsDB.create(subscription)
  ).toObject() as ISubscriptionCreationResult;
};

export const updateSubscriptionResult = async (
  subscription: ISubscriptionCreationResult
): Promise<ISubscriptionCreationResult | undefined> => {
  return (
    await SubscriptionsDB.findOneAndUpdate(
      { subscriptionId: subscription.subscriptionId },
      { ...subscription },
      {
        new: true,
      }
    )
  )?.toObject();
};

export const hookEventsFromStripe = async (req: Request, res: Response) => {
  if (!stripeInstance) stripeInstance = await initializeStripe();
  if (!stripeInstance)
    return res
      .status(500)
      .json(new AppResult(AppErrorsMessages.INTERNAL_ERROR, undefined, 500));

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error(AppErrorsMessages.INTERNAL_ERROR);
  }

  let event;

  try {
    event = stripeInstance.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"] as any,
      webhookSecret
    );
  } catch (error: any) {
    log.error(`Webhook Error ${error.message}`);
    return res
      .status(500)
      .json(new AppResult(`Webhook Error`, error.message, 500));
  }
  if (!event)
    return res
      .status(500)
      .json(new AppResult(AppErrorsMessages.INTERNAL_ERROR, undefined, 500));

  if (event.type.includes("payment_intent")) {
    handlePaymentIntent(event);
  } else if (event.type.includes("invoice")) {
    handleInvoice(event);
  }

  return res.send();
};
