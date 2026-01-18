import express from "express";
import bodyParser from "body-parser";

const router = express.Router();

// In-memory data store
let posts = [
    {
        id: 1,
        title: "The Rise of Decentralized Finance",
        content: "Decentralized Finance (DeFi) is an emerging and rapidly evolving field in the blockchain industry...",
        author: "Alex Thompson",
        date: "2023-08-01T10:00:00Z",
    },
    {
        id: 2,
        title: "The Impact of Artificial Intelligence on Modern Businesses",
        content: "Artificial Intelligence (AI) is no longer a concept of the future...",
        author: "Mia Williams",
        date: "2023-08-05T14:30:00Z",
    },
    {
        id: 3,
        title: "Sustainable Living: Tips for an Eco-Friendly Lifestyle",
        content: "Sustainability is more than just a buzzword; it's a way of life...",
        author: "Samuel Green",
        date: "2023-08-10T09:15:00Z",
    },
];

let lastId = 3;

// Middleware
router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json());

// ---------------------
// PAGE ROUTES
// ---------------------

// Main blog page
router.get("/", (req, res) => {
    res.render("project30/index.ejs", { posts });
});

// "New Post" page
router.get("/new", (req, res) => {
    res.render("project30/modify.ejs", { heading: "New Post", submit: "Create Post" });
});

// "Edit Post" page
router.get("/edit/:id", (req, res) => {
    const post = posts.find(p => p.id == req.params.id);
    if (!post) return res.status(404).send("Post not found");
    res.render("project30/modify.ejs", { heading: "Edit Post", submit: "Update Post", post });
});

// ---------------------
// API ROUTES
// ---------------------

// GET all posts
router.get("/posts", (req, res) => {
    res.json(posts);
});

// GET single post by ID
router.get("/posts/:id", (req, res) => {
    const post = posts.find(p => p.id == req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
});

// CREATE new post
router.post("/posts", (req, res) => {
    const { title, content, author } = req.body;
    if (!title || !content || !author) return res.status(400).send("All fields are required");

    const newPost = { id: ++lastId, title, content, author, date: new Date().toISOString() };
    posts.push(newPost);

    // Redirect back to main page
    res.redirect("/project30");
});

// UPDATE post (via POST form instead of PATCH for simplicity)
router.post("/posts/:id", (req, res) => {
    const post = posts.find(p => p.id == req.params.id);
    if (!post) return res.status(404).send("Post not found");

    const { title, content, author } = req.body;
    if (title) post.title = title;
    if (content) post.content = content;
    if (author) post.author = author;

    res.redirect("/project30");
});

// DELETE post
router.get("/posts/delete/:id", (req, res) => {
    const index = posts.findIndex(p => p.id == req.params.id);
    if (index === -1) return res.status(404).send("Post not found");

    posts.splice(index, 1);
    res.redirect("/project30");
});

export default router;
