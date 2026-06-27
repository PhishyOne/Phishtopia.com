import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./src/app.js";

const PORT = process.env.PORT || 3002;
const app = await createApp();

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
