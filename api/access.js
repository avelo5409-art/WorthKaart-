export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).send("Server configuration missing");
    }

    const token = req.query.token;

    if (!token || typeof token !== "string") {
      return res.status(401).send(`
        <h2>Invalid access link</h2>
        <p>Please use the access link sent to your email.</p>
      `);
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?access_token=eq.${encodeURIComponent(
        token
      )}&status=eq.paid&select=id,email,access_expires_at`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!response.ok) {
      return res.status(500).send("Could not verify access");
    }

    const orders = await response.json();

    if (!orders.length) {
      return res.status(403).send(`
        <h2>Access not found</h2>
        <p>This access link is invalid or inactive.</p>
      `);
    }

    const order = orders[0];

    if (
      order.access_expires_at &&
      new Date(order.access_expires_at) <= new Date()
    ) {
      return res.status(403).send(`
        <h2>Access expired</h2>
        <p>This access link has expired.</p>
      `);
    }

    const downloadUrl =
      `/api/download?token=${encodeURIComponent(token)}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>Bachelor's Kitchen — Your Ebook</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #0a0a0a;
      color: #fff;
      font-family: Arial, sans-serif;
    }

    .card {
      width: 100%;
      max-width: 520px;
      padding: 42px 28px;
      text-align: center;
      border: 1px solid #252525;
      border-radius: 22px;
      background: #111;
    }

    .badge {
      display: inline-block;
      margin-bottom: 18px;
      padding: 7px 13px;
      border-radius: 999px;
      background: #1c1c1c;
      color: #c9a84c;
      font-size: 13px;
      font-weight: 600;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 30px;
    }

    p {
      margin: 0 auto 26px;
      max-width: 420px;
      line-height: 1.6;
      color: #aaa;
    }

    .download {
      display: inline-block;
      padding: 14px 24px;
      border-radius: 999px;
      background: #c9a84c;
      color: #000;
      text-decoration: none;
      font-weight: 700;
    }

    .note {
      margin-top: 20px;
      font-size: 13px;
      color: #777;
    }
  </style>
</head>

<body>
  <main class="card">
    <div class="badge">PAYMENT VERIFIED ✓</div>

    <h1>Bachelor's Kitchen</h1>

    <p>
      Your purchase is verified. Your ebook is ready to download.
    </p>

    <a class="download" href="${downloadUrl}">
      Download Ebook
    </a>

    <div class="note">
      Your access link is valid for future downloads.
    </div>
  </main>
</body>
</html>
    `);
  } catch (error) {
    console.error("Access error:", error);

    return res.status(500).send(`
      <h2>Something went wrong</h2>
      <p>Please try again later.</p>
    `);
  }
}
