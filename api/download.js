export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        error: "Server configuration missing",
      });
    }

    // Access token from customer link
    const token = req.query.token;

    if (!token || typeof token !== "string") {
      return res.status(401).json({
        error: "Access token required",
      });
    }

    // Verify that this token belongs to a paid order
    const orderResponse = await fetch(
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

    if (!orderResponse.ok) {
      return res.status(500).json({
        error: "Could not verify access",
      });
    }

    const orders = await orderResponse.json();

    if (!orders.length) {
      return res.status(403).json({
        error: "Invalid or inactive access link",
      });
    }

    const order = orders[0];

    // NULL expiry = lifetime access
    if (
      order.access_expires_at &&
      new Date(order.access_expires_at) <= new Date()
    ) {
      return res.status(403).json({
        error: "Access link has expired",
      });
    }

    // Exact PDF filename inside private "ebook" bucket
    const filePath =
      "Bachelor's_Kitchen_99_High_Protein_Recipes (1).pdf";

    // Generate a temporary signed URL
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/sign/ebook/${encodeURIComponent(
        filePath
      )}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expiresIn: 300,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Supabase Storage error:", errorText);

      return res.status(500).json({
        error: "Could not create secure download link",
      });
    }

    const data = await response.json();

    if (!data.signedURL) {
      return res.status(500).json({
        error: "Signed URL was not generated",
      });
    }

    return res.redirect(302, data.signedURL);
  } catch (error) {
    console.error("Download error:", error);

    return res.status(500).json({
      error: "Download failed",
    });
  }
}
