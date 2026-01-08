/**
 * Stripe Service for CCNA Mastery
 * In a production app, the Secret Key stays on your server.
 * This client helper initiates the redirect to Stripe.
 */

// Replace this with your actual Stripe Publishable Key (starts with pk_test_...)
const STRIPE_PUBLISHABLE_KEY = 'pk_test_PASTE_YOUR_KEY_HERE';

export const startStripeCheckout = async (deckId?: string | null, deckName?: string | null) => {
  console.log("Starting Stripe Checkout for $39...");

  // In a real environment, you would call your backend endpoint here:
  // const response = await fetch('/api/create-checkout-session', { method: 'POST' });
  // const session = await response.json();
  // const stripe = await (window as any).Stripe(STRIPE_PUBLISHABLE_KEY);
  // await stripe.redirectToCheckout({ sessionId: session.id });

  // SIMULATOR MODE:
  // Since we are in a frontend-only test environment, we simulate the redirect
  // After 1 second, we'll "redirect" to the success URL.
  // In your real app, Stripe handles this redirect.
  
  const successUrl = `${window.location.origin}${window.location.pathname}?success=true${deckId ? `&deckId=${deckId}` : ''}${deckName ? `&deckName=${encodeURIComponent(deckName)}` : ''}`;
  
  // To simulate the Stripe checkout page experience:
  alert("REDIRECTING TO STRIPE (Test Mode)\n\nUse Test Card: 4242 4242 4242 4242\nAmount: $39.00");
  
  window.location.href = successUrl;
};
