# Phishtopia Refactor Plan

This branch is for cleaning up the existing site structure before adding StoreCalc Online.

## Goals

- Keep existing public routes working.
- Move production app structure away from course-project naming.
- Make `index.js` responsible only for starting the server.
- Move Express app setup into `src/app.js`.
- Extract middleware, configuration, routing, services, and database query logic into clear folders.
- Keep legacy App Brewery/course projects available while making mature features easier to maintain.

## Target Structure

```text
src/
  app.js
  config/
  middleware/
  routes/
  controllers/
  services/
  db/
  cache/
```

## Cleanup Phases

1. Split server boot, app creation, middleware, and route mounting.
2. Move shared database config into `src/db` while keeping compatibility imports for old project files.
3. Move auth into first-class app modules.
4. Rename YouList internals away from `project34` while preserving `/youlist` and existing assets.
5. Leave legacy course projects working while moving new features into the cleaner structure.
6. Add smoke-test scripts before merging to `main`.

## Safety Notes

`main` auto-deploys to production. Refactor work should stay on this branch until tested.
