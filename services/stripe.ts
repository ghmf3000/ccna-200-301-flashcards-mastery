// services/stripe.ts
export async function startStripeCheckout(userId: string, email?: string) {
  const res = await fetch("/api/stripe/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, email }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || "Checkout failed");
  }

  if (!data?.url) {
    throw new Error("Missing checkout URL from server");
  }

  window.location.href = data.url;
}
