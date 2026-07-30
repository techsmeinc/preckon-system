// Test env defaults. Point at the docker-compose MySQL (mapped to :3308 on the
// host). Tests assume the schema is loaded and `npm run seed` has run against a
// dedicated test database (see test/README or the seed step in package scripts).
process.env.DATABASE_HOST ??= "127.0.0.1";
process.env.DATABASE_PORT ??= "3308";
process.env.DATABASE_USER ??= "root";
process.env.DATABASE_PASSWORD ??= "preckon";
process.env.DATABASE_NAME ??= "preckon_tenant";
process.env.INTERNAL_SERVICE_TOKEN ??= "test-token";
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long!!";
process.env.NODE_ENV ??= "test";
