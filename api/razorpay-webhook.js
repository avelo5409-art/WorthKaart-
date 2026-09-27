import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!webhookSecret || !supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: "Server configuration missing" });
    }

    const rawBody =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({ error: "Missing signature" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    ) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const payload =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const event = payload.event;
    const payment = payload.payload?.payment?.entity;

    if (!payment) {
      return res.status(200).json({ received: true });
    }

    if (event === "payment.captured") {
      const email = payment.email || null;
      const paymentId = payment.id || null;
      const orderId = payment.order_id || null;

      const response = await fetch(
        `${supabaseUrl}/rest/v1/orders`,
        {
          method: "POST",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            email,
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            status: "paid"
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Supabase error:", errorText);
        return res.status(500).json({ error: "Database error" });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}
