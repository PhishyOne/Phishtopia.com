import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async(req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM fullstack.items_33_3 ORDER BY id"
    );
    const items = result.rows;
    res.render("project33-3", {
      listTitle: "Today",
      listItems: items,
  });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("Database error");
  }
});

router.post("/add", async (req, res) => {
  try {
    const item = req.body.newItem;

    if (!item || !item.trim()) {
      return res.redirect("/project33-3");
    }

    await db.query(
      "INSERT INTO fullstack.items_33_3 (title) VALUES ($1)",
      [item.trim()]
    );

    res.redirect("/project33-3");
  } catch (err) {
    console.error("DB insert error:", err);
    res.status(500).send("Failed to add item");
  }
});

router.post("/edit", async (req, res) => {
  try {
    const item = req.body.updatedItemTitle;
    const itemId = req.body.updatedItemId;
    if (!item || !item.trim()) {
      return res.redirect("/project33-3");
    }

    await db.query(
      "UPDATE fullstack.items_33_3 SET title = $1 WHERE id = $2",
      [item.trim(), itemId]
    );

    res.redirect("/project33-3");
  } catch (err) {
    console.error("DB insert error:", err);
    res.status(500).send("Failed to edit item");
  }
});

router.post("/delete", async (req, res) => {
  try {
    const itemId = req.body.deleteItemId;

    if (!itemId) {
      return res.redirect("/project33-3");
    }

    await db.query(
      "DELETE FROM fullstack.items_33_3 WHERE id = $1",
      [itemId]
    );

    res.redirect("/project33-3");
  } catch (err) {
    console.error("DB insert error:", err);
    res.status(500).send("Failed to edit item");
  }
});

export default router;