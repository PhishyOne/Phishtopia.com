import express from "express";
import db from "/public/js/db.js";

const router = express.Router();

let currentUserId = 1;

//Main Page Route
router.get("/", async (req, res) => {
  try {
    const usersResult = await db.query(
      "SELECT * FROM fullstack.users_33_2 ORDER BY id"
    );

    const currentUser = usersResult.rows.find(
      u => u.id === currentUserId
    );

    const result = await db.query(
      `
      SELECT country_code
      FROM fullstack.visited_countries_33_2
      WHERE user_id = $1
      `,
      [currentUserId]
    );

    const countries = result.rows.map(row => row.country_code);
    const error = req.query.error || ""; // Get error message from query param

    res.render("project33-2", {
      countries,
      total: countries.length,
      users: usersResult.rows,
      color: currentUser?.color || "teal",
      error,
      extraStyles: ["/project33-2/styles/main.css"], // <-- add this
      extraScripts: [], // optional, add project-specific scripts if any
      bodyClass: "project33-2" // optional, useful for CSS
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("Database error");
  }
});

//Add Country to Visited Countries Db
router.post("/add", async (req, res) => {
  const typedCountry = req.body.country?.trim();
  console.log("Typed country:", typedCountry);

  if (!typedCountry) {
    return res.redirect("/project33-2?error=Please enter a country");
  }

  try {
    // 1️⃣ Find the country code
    const countryResult = await db.query(
      "SELECT country_code FROM fullstack.countries_33_1 WHERE country_name ILIKE $1",
      [`%${typedCountry}%`]
    );

    if (countryResult.rowCount === 0) {
      console.log(`No country found for "${typedCountry}"`);
      return res.redirect("/project33-2?error=Country not found");
    }

    const countryCode = countryResult.rows[0].country_code;

    // 2️⃣ Check if this user already added this country
    const existsResult = await db.query(
      `SELECT 1 FROM fullstack.visited_countries_33_2
       WHERE user_id = $1 AND country_code = $2`,
      [currentUserId, countryCode]
    );

    if (existsResult.rowCount > 0) {
      console.log(`User ${currentUserId} already added country ${countryCode}`);
      return res.redirect("/project33-2?error=Country already added");
    }

    // 3️⃣ Insert the country for this user
    await db.query(
      `INSERT INTO fullstack.visited_countries_33_2 (user_id, country_code)
       VALUES ($1, $2)`,
      [currentUserId, countryCode]
    );

    console.log(`Inserted country ${countryCode} for user ${currentUserId}`);
    res.redirect("/project33-2");

  } catch (err) {
    // Catch everything including UNIQUE constraint errors
    console.error("DB error on insert:", err);

    // Check if it’s a UNIQUE violation just in case
    if (err.code === "23505") {
      return res.redirect("/project33-2?error=Country already added");
    }

    // Otherwise, generic database error
    res.redirect("/project33-2?error=Database error");
  }
});

//Autocomplete Query of Countries
router.get("/search", async (req, res) => {
  const query = req.query.q?.trim();
  console.log("Query: " + query)
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

//Clear from Visited Countries Db
router.post("/clear", async (req, res) => {
  await db.query(
    "DELETE FROM fullstack.visited_countries_33_2 WHERE user_id = $1",
    [currentUserId]
  );
  res.redirect("/project33-2");
});

router.get("/new", (req, res) => {
  res.render("project33-2/new", {
    extraStyles: ["/project33-2/styles/main.css"],
    extraScripts: [],
    bodyClass: "project33-2"
  });
});

//Create New User
router.post("/new", async (req, res) => {
  //Hint: The RETURNING keyword can return the data that was inserted.
  //https://www.postgresql.org/docs/current/dml-returning.html
  const name = req.body.name;
  const color = req.body.color;
  console.log("New User: " + name + " Color: " + color);

  try {
    const result = await db.query(
      "INSERT INTO fullstack.users_33_2 (name, color) VALUES ($1, $2) RETURNING id",
      [name, color]
    );
    const newUserId = result.rows[0].id;
    currentUserId = newUserId;
    console.log(`Inserted new user with ID: ${newUserId}`);
    res.redirect("/project33-2");
  } catch (err) {
    console.error("DB error on new user:", err);
    res.status(500).send("Database error on new user");
  }
});
//Select User Tab
router.post("/user", (req, res) => {
  const userId = req.body.user;

  // "Add New Family Member" button
  if (!userId) {
    return res.redirect("/project33-2/new");
  }

  currentUserId = Number(userId);
  res.redirect("/project33-2");
});

export default router;