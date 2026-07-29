import {
  APPLE_REFRESH_CREDENTIAL_MIGRATION,
  AUTH_PROVIDER_EXPANSION_MIGRATION,
  AUTH_SESSION_ROTATION_MIGRATION,
} from "./auth/migrations.js";
import { TRANSIT_MIGRATIONS } from "./transit/migrations.js";
import { PARK_ROUTE_MIGRATION } from "./parks/migrations.js";

export type AppMigration = {
  version: number;
  name: string;
  sql: string;
};

export const APP_MIGRATIONS: ReadonlyArray<AppMigration> = [
  ...TRANSIT_MIGRATIONS,
  AUTH_SESSION_ROTATION_MIGRATION,
  AUTH_PROVIDER_EXPANSION_MIGRATION,
  APPLE_REFRESH_CREDENTIAL_MIGRATION,
  PARK_ROUTE_MIGRATION,
].sort((first, second) => first.version - second.version);
