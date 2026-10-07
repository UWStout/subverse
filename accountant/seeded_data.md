All seeded accounts share the same password, so here are three handy ones:

| Role        | Username   | Password      | Notes                                                             |
|-------------|------------|---------------|-------------------------------------------------------------------|
| **Admin**   | `admin`    | `password123` | Full access to everything                                         |
| **Teacher** | `lito`     | `password123` | Teaches GDD 200 – SUMMER26, section 103                           |
| **Student** | `lellison` | `password123` | Assigned to one project: *Release Manager Sim* (CS-458, SPRING26) |
A couple of extras that are useful for testing specific behaviors:

- **Unassigned student**: `rfoster` / `password123` — has no project assignments, so you can verify the empty state and the 403s on project details
- **Multi-project student**: `nibarra` / `password123` — assigned to 3 projects across different offerings

Since the seed is deterministic (PRNG seed 42), these same usernames will come back if you clear and reseed. And remember: when you're done, `npm run db:clear` wipes everything back to an empty database.
