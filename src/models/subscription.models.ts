import { model, Schema } from "mongoose";
import { PlansTypes } from "./user.models";

export interface ICreateSubscriptionProps {
  currency: string;
  recurrency: "month" | "year";
  planType: PlansTypes;
  tokenEmail: string;
  tokenUid: string;
}

export interface ISubscriptionCreationResult {
  subscriptionId: string;
  subscriptionEnd: number;
  subscriptionStart: number;
  currency: string;
  priceId: string;
  recurrency?: string;
  customer: any;
  latestInvoice: any;
  userId: string;
  status: string;
}

const subscriptionSchema = new Schema<ISubscriptionCreationResult>(
  {
    subscriptionId: { type: String },
    subscriptionEnd: { type: Number },
    subscriptionStart: { type: Number },
    currency: { type: String },
    priceId: { type: String },
    recurrency: { type: String },
    customer: { type: Object },
    latestInvoice: { type: Object },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "Users",
    },
    status: { type: String },
  },
  {
    timestamps: true,
  }
);

export default model<ISubscriptionCreationResult>(
  "Subscriptions",
  subscriptionSchema
);
