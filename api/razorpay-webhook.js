import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!webhookSecret || !supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        error: "Server configuration missing",
      });
    }

    const rawBody = await getRawBody(req);
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({
        error: "Missing Razorpay signature",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const received = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      return res.status(401).json({
        error: "Invalid signature",
      });
    }

    const payload = JSON.parse(rawBody.toString("utf8"));

    if (payload.event !== "payment.captured") {
      return res.status(200).json({
        received: true,
        processed: false,
      });
    }

    const payment = payload.payload?.payment?.entity;

    if (!payment) {
      return res.status(400).json({
        error: "Payment data missing",
      });
    }

    const email = payment.email || null;
    const paymentId = payment.id || null;
    const orderId = payment.order_id || null;

    if (!paymentId) {
      return res.status(400).json({
        error: "Payment ID missing",
      });
    }

    // Check if this payment was already processed
    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?razorpay_payment_id=eq.${encodeURIComponent(
        paymentId
      )}&select=id`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!existingResponse.ok) {
      return res.status(500).json({
        error: "Database lookup failed",
      });
    }

    const existingOrders = await existingResponse.json();

    if (existingOrders.length > 0) {
      return res.status(200).json({
        received: true,
        processed: false,
        message: "Payment already recorded",
      });
    }

    // Generate secure lifetime access token
    const accessToken = crypto.randomBytes(32).toString("hex");

    // Save paid order + access token
    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          email,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          status: "paid",
          access_token: accessToken,
          access_expires_at: null,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Supabase error:", errorText);

      return res.status(500).json({
        error: "Failed to save payment",
      });
    }

    console.log("Payment recorded successfully:", paymentId);

    return res.status(200).json({
      received: true,
      processed: true,
    });
  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(500).json({
      error: "Webhook processing failed",
    });
  }
}
