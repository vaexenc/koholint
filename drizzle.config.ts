import {defineConfig} from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/server/store/db/schema.ts",
	out: "./src/server/store/db/migrations",
	dbCredentials: {url: "./_data/db/koholint.db"},
});
