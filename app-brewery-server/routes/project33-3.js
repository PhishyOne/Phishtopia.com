import express from "express";
import db from "../db.js";

const router = express.Router();

let items = [
  { id: 1, title: "Buy milk" },
  { id: 2, title: "Finish homework" },
];

router.get("/", (req, res) => {
  res.render("project33-3", {
    listTitle: "Today",
    listItems: items,
  });
});

router.post("/add", (req, res) => {
  const item = req.body.newItem;
  items.push({ title: item });
  res.redirect("/project33-3");
});

router.post("/edit", (req, res) => {});

router.post("/delete", (req, res) => {});

export default router;