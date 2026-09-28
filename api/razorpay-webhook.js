import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

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
    const resendApiKey = process.env.RESEND_API_KEY;

    if (
      !webhookSecret ||
      !supabaseUrl ||
      !supabaseKey ||
      !resendApiKey
    ) {
      console.error("Missing server environment variable");

      return res.status(500).json({
        error: "Server configuration missing",
      });
    }

    // --------------------------------------------------
    // 1. Read Razorpay raw webhook body
    // --------------------------------------------------

    const rawBody = await getRawBody(req);

    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({
        error: "Missing Razorpay signature",
      });
    }

    // --------------------------------------------------
    // 2. Verify Razorpay webhook signature
    // --------------------------------------------------

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      console.error("Invalid Razorpay signature");

      return res.status(401).json({
        error: "Invalid signature",
      });
    }

    // --------------------------------------------------
    // 3. Parse webhook
    // --------------------------------------------------

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

    if (!email) {
      console.error("Customer email missing for payment:", paymentId);

      return res.status(400).json({
        error: "Customer email missing",
      });
    }

    // --------------------------------------------------
    // 4. Check if payment was already processed
    // --------------------------------------------------

    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?razorpay_payment_id=eq.${encodeURIComponent(
        paymentId
      )}&select=id,access_token`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!existingResponse.ok) {
      const errorText = await existingResponse.text();

      console.error("Supabase lookup error:", errorText);

      return res.status(500).json({
        error: "Database lookup failed",
      });
    }

    const existingOrders = await existingResponse.json();

    // Already processed
    if (existingOrders.length > 0) {
      return res.status(200).json({
        received: true,
        processed: false,
        message: "Payment already recorded",
      });
    }

    // --------------------------------------------------
    // 5. Generate secure lifetime access token
    // --------------------------------------------------

    const accessToken = crypto.randomBytes(32).toString("hex");

    const accessUrl =
      `https://worth-kaart.vercel.app/api/access?token=${encodeURIComponent(
        accessToken
      )}`;

    // --------------------------------------------------
    // 6. Save paid order in Supabase
    // --------------------------------------------------

    const saveResponse = await fetch(
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

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();

      console.error("Supabase save error:", errorText);

      return res.status(500).json({
        error: "Failed to save payment",
      });
    }

    // --------------------------------------------------
    // 7. Send access email through Resend
    // --------------------------------------------------

    const emailResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "WorthKaart <onboarding@resend.dev>",
          to: [email],
          subject: "Your Bachelor's Kitchen Ebook is Ready 📖",
          html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">

  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;">

    <div style="padding:32px;text-align:center;background:#0a0a0a;color:#ffffff;">
      <h1 style="margin:0;font-size:28px;">
        Bachelor's Kitchen
      </h1>

      <p style="margin:10px 0 0;color:#c9a84c;">
        99 High-Protein Recipes on a Budget
      </p>
    </div>

    <div style="padding:36px 30px;text-align:center;">

      <div style="font-size:38px;margin-bottom:15px;">
        ✓
      </div>

      <h2 style="margin:0 0 12px;color:#111111;">
        Payment Successful!
      </h2>

      <p style="font-size:16px;line-height:1.6;color:#555555;">
        Thanks for purchasing Bachelor's Kitchen.
        Your ebook is ready to access.
      </p>

      <a
        href="${accessUrl}"
        style="
          display:inline-block;
          margin-top:18px;
          padding:15px 26px;
          background:#c9a84c;
          color:#000000;
          text-decoration:none;
          border-radius:999px;
          font-weight:bold;
        "
      >
        Access & Download Ebook
      </a>

      <p style="margin-top:25px;font-size:13px;line-height:1.5;color:#888888;">
        This is your personal access link.
        You can use it again whenever you need to download your ebook.
      </p>

    </div>

    <div style="padding:20px;text-align:center;border-top:1px solid #eeeeee;">
      <p style="margin:0;font-size:12px;color:#999999;">
        WorthKaart · Bachelor's Kitchen
      </p>
    </div>

  </div>

</body>
</html>
          `,
        }),
      }
    );

    if (!emailResponse.ok) {
      const emailError = await emailResponse.text();

      console.error("Resend email error:", emailError);

      // Payment is already safely recorded.
      // Do not mark the webhook as completely failed because
      // Razorpay may retry and create duplicate processing.
      return res.status(200).json({
        received: true,
        processed: true,
        emailSent: false,
        message: "Payment saved but email could not be sent",
      });
    }

    const emailResult = await emailResponse.json();

    console.log("Payment recorded:", paymentId);
    console.log("Access email sent:", emailResult.id);

    // --------------------------------------------------
    // 8. Done
    // --------------------------------------------------

    return res.status(200).json({
      received: true,
      processed: true,
      emailSent: true,
    });
  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(500).json({
      error: "Webhook processing failed",
    });
  }
}
