import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

export const config = {
  api: { bodyParser: false },
};

async function buffer(readable: any) {
  const chunks: any[] = [];
  for await (const chunk of readable) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const sig = req.headers["stripe-signature"] as string;
    const rawBody = await buffer(req);

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;

      if (userId) {
        // ✅ Store entitlement in KV (fast + simple) OR your DB later
        // For now we’ll use Vercel KV REST API (next step) OR Supabase if you prefer.
        // Placeholder response:
        console.log("Payment complete for userId:", userId);
      }
    }

    return res.status(200).json({ received: true });
  } catch (e: any) {
    console.error("Webhook error:", e?.message);
    return res.status(400).send(`Webhook Error: ${e?.message}`);
  }
}
