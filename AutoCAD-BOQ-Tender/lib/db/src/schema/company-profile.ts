import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton table — exactly one row (id = 1) holding the user's company letterhead
// info that gets stamped onto every exported BOQ.
export const companyProfileTable = mysqlTable("company_profile", {
  id: int("id").primaryKey().default(1),
  companyName: varchar("company_name", { length: 255 }).notNull().default(""),
  addressLine1: varchar("address_line_1", { length: 255 }).notNull().default(""),
  addressLine2: varchar("address_line_2", { length: 255 }).notNull().default(""),
  phone: varchar("phone", { length: 100 }).notNull().default(""),
  email: varchar("email", { length: 255 }).notNull().default(""),
  website: varchar("website", { length: 255 }).notNull().default(""),
  refPrefix: varchar("ref_prefix", { length: 50 }).notNull().default("QO"),
  currencyCode: varchar("currency_code", { length: 10 }).notNull().default("KWD"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanyProfileSchema = createInsertSchema(companyProfileTable).omit({ id: true, updatedAt: true });
export type InsertCompanyProfile = z.infer<typeof insertCompanyProfileSchema>;
export type CompanyProfile = typeof companyProfileTable.$inferSelect;
