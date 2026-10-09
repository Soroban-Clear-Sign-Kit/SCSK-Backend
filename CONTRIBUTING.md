# Contributing to Soroban Clear-Sign Kit

We welcome contributions! This project is part of the Stellar Wave program and we are excited to have you on board.

## Setup Commands

To set up the repository locally:

```bash
pnpm install
```

## Running Tests

To run the unit tests and coverage:

```bash
pnpm run test
pnpm run test:coverage
```

To run integration tests (requires testnet secrets in `.env`):

```bash
pnpm run test:integration
```

## Commit Convention

Please ensure your commits follow the Conventional Commits specification. We use small, conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Pull Request Checklist

When submitting a PR, please ensure:

- [ ] Tests added for any new functionality or bug fixes.
- [ ] Code is lint-clean (`pnpm run lint` passes).
- [ ] Documentation is updated if API changes were made.

## Requesting Issue Assignment

If you want to work on an issue, please leave a comment on the issue asking to be assigned. Wait for a maintainer to assign it to you before starting work to avoid duplicated effort.

## Stellar Wave Program

This project is intended to be applied to the Drips Stellar Wave program. If you see issues labeled as part of the Wave program, they are eligible for wave rewards. Please review the Wave guidelines before contributing to those issues.
