import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Temporary placeholder until we wire KV/DB in the next step
  // We'll return false unless localStorage says true (client will update later)
  return res.status(200).json({ isPro: false });
}
