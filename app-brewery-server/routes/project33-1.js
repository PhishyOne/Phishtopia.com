import express from "express";
import bodyParser from "body-parser";
import pg from "pg";

const router = express.Router();

router.use(bodyParser.urlencoded({ extended: true }));

const db = new pg.Client({
  user: "uejgslvtpkiinu",
  host: "casrkuuedp6an1.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com",
  database: "d8uopajfmdjv48",
  password: "p32a8f8cf831e5db7fc8171966ff8a9a88b616266ff9c6ce3619db2b30754981f",
  port: 5432,
  ssl: {
    rejectUnauthorized: false,
  },
});

await db.connect();

// GET route: display all visited countries and optional error
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT country_code FROM fullstack.visited_countries_33_1"
    );
    const countries = result.rows.map(row => row.country_code);
    const error = req.query.error || ""; // Get error message from query param

    res.render("project33-1", {
      countries,
      total: countries.length,
      extraStyles: ["/project33-1/styles/main.css"],
      error
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("Database error");
  }
});

// POST route: add a new country
router.post("/add", async (req, res) => {
  const typedCountry = req.body.country?.trim();
  console.log("Typed country: " + typedCountry);

  try {
    // Find country code by name (case-insensitive, partial match)
    const countryResult = await db.query(
      "SELECT country_code FROM fullstack.countries_33_1 WHERE country_name ILIKE $1",
      [`%${typedCountry}%`]
    );

    if (countryResult.rowCount === 0) {
      console.log(`No country found for "${typedCountry}"`);
      return res.redirect("/project33-1?error=Country not found");
    }

    const code = countryResult.rows[0].country_code;

    // Insert country code (UNIQUE constraint prevents duplicates)
    try {
      await db.query(
        "INSERT INTO fullstack.visited_countries_33_1 (country_code) VALUES ($1)",
        [code]
      );
      console.log(`Inserted country code: ${code}`);
    } catch (err) {
      if (err.code === "23505") { // Unique violation
        console.log(`Country code ${code} already exists`);
        return res.redirect("/project33-1?error=Country already added");
      } else {
        throw err;
      }
    }

    res.redirect("/project33-1");

  } catch (err) {
    console.error("DB error on insert:", err);
    res.status(500).send("Database error on insert");
  }
});

router.get("/search", async (req, res) => {
  const query = req.query.q?.trim();

  if (!query || query.length < 2) {
    return res.json([]); // don't search on 1 character
  }

  try {
    const result = await db.query(
      `
      SELECT country_name
      FROM fullstack.countries_33_1
      WHERE country_name ILIKE $1
      ORDER BY country_name
      LIMIT 10
      `,
      [`%${query}%`]
    );

    res.json(result.rows.map(row => row.country_name));
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json([]);
  }
});

router.post("/clear", async (req, res) => {
  try {
    await db.query("DELETE FROM fullstack.visited_countries_33_1");
    console.log("Cleared all visited countries");
    res.redirect("/project33-1");
  } catch (err) {
    console.error("DB error on clear:", err);
    res.status(500).send("Database error on clear");
  }
});
export default router;
