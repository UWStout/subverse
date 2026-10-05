## Roles Permission Matrix
Below are tables that explain the different permissions for various routes afforded to the different user types.

### User routes
| Route | STUDENT | TEACHER  | ADMIN |
|-------|---------|----------|-------|
| `GET /user/list/:type` | ❌ 403 | ✅  | ✅  |
| `GET /user/check/:username/:email` | ✅  | ✅ | ✅  |
| `GET /user/:id`| ⚠️ Own account only (`id === sub`) | ✅ | ✅ |
| `POST /user/create`| ❌ 403 | ⚠️ STUDENT or TEACHER only - **never ADMIN** | ✅ any type |
| `POST /user/update/:id` | ⚠️ Own account only (`id === sub`); no type changes | ⚠️ Student accounts or own account only; no type changes | ✅ Any target; may change type (last-admin guard applies) |
| `DELETE /user/:id`| ❌ 403 | ⚠️ STUDENT or TEACHER targets only - **never ADMIN** | ✅ Any target (last-admin guard applies) |

Note: the `:type` parameter of `GET /user/list/:type` also accepts a comma-separated list of types (e.g. `TEACHER,ADMIN`) to match any of the listed types.

### Global User invariants (apply on top of the matrix)

1. **TYPE changes are admin-only** - any non-admin update request that includes a `type` field is rejected with 403, regardless of target.

2. **Last-admin protection** - no one may:
   - delete the last remaining ADMIN account (including self-delete), or
   - change the last remaining ADMIN's type from `ADMIN` to anything else.

   Both are enforced by counting `user.count({ where: { type: 'ADMIN' } })`; the count is only consulted when an ADMIN target is actually affected, so normal student/teacher updates and deletes never pay for it.

### Class Routes
The different user accounts have the following permission restrictions:

| Route | STUDENT | TEACHER  | ADMIN |
|-------|---------|----------|-------|
| `GET /class/list/` | ✅ | ✅ | ✅ |
| `GET /class/:id`| ✅ | ✅ | ✅ |
| `POST /class/create`| ❌ 403 | ✅ | ✅ |
| `POST /class/update/:id` | ❌ 403 | ✅ | ✅ |
| `DELETE /class/:id`| ❌ 403 | ✅ | ✅ |

Note that deleting should only be allowed when the class has no offerings. It should not cascade. Offerings should need to be deleted first.

### Offering Routes
The different user accounts have the following permission restrictions:

| Route | STUDENT | TEACHER  | ADMIN |
|-------|---------|----------|-------|
| `GET /offering/terms/` | ✅ | ✅ | ✅  |
| `GET /offering/list/` | ⚠️ Only classes with assigned projects | ⚠️ Only offerings they teach | ✅ |
| `GET /offering/:id`| ⚠️ Only classes with assigned projects | ✅ | ✅ |
| `POST /offering/create`| ❌ 403 | ⚠️ (with themselves as teacher) | ✅ |
| `POST /offering/update/:id` | ❌ 403 | ⚠️ (with themselves as teacher, can't change teacher) | ✅ |
| `DELETE /offering/:id`| ❌ 403 | ⚠️ (with themselves as teacher) | ✅ |

So anyone can get the list of terms. Students can only list the offerings of get details for classes where they have assignments (they cannot create, update, or delete). Teachers can only list, get details, create, update, or delete their OWN classes. Admins can do everything.

### Project Routes
The different user accounts have the following permission restrictions:

| Route | STUDENT | TEACHER  | ADMIN |
|-------|---------|----------|-------|
| `GET /project/list/` | ⚠️ (only for assigned projects) | ✅ | ✅ |
| `GET /project/:id`| ⚠️ (only for assigned projects; no student details) | ✅ | ✅ |
| `POST /project/create`| ❌ 403 | ⚠️ (only in classes they teach) | ✅ |
| `POST /project/update/:id` | ❌ 403 | ⚠️ (only in classes they teach) | ✅ |
| `DELETE /project/:id`| ❌ 403 | ⚠️ (only in classes they teach) | ✅ |

Students can only read projects and only ones that they are assigned to. When using the details route, students should NOT see other student info so assignments should not be included. Teachers can read any projects but only create, update, or delete ones that are part of their offerings. Admins have all permissions.
