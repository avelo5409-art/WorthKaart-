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

    // Exact PDF filename inside the private "ebook" bucket
    const filePath =
      "Bachelor's_Kitchen_99_High_Protein_Recipes (1).pdf";

    // Create a temporary signed URL valid for 5 minutes
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
