<p align="center">
  <a href="https://vendure.io">
    <img alt="Vendure logo" height="60" width="auto" src="https://assets.vendure.io/brand/logo-icon-vendure-blue.svg">
  </a>
</p>

<h1 align="center">
  Vendure Core
</h1>
<h3 align="center">
    Headless TypeScript commerce backend on NestJS. GraphQL API, plugin-first, runs anywhere.
</h3>
<h4 align="center">
  <a href="https://docs.vendure.io">Documentation</a> |
  <a href="https://vendure.io">Website</a>
</h4>

<p align="center">
  <a href="https://github.com/vendurehq/vendure/blob/master/LICENSE.md">
    <img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="Vendure Core is released under the GPLv3 license." />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=vendure_io">
    <img src="https://img.shields.io/twitter/follow/vendure_io" alt="Follow @vendure_io" />
  </a>
  <a href="https://vendure.io/community">
    <img src="https://img.shields.io/badge/join-our%20discord-7289DA.svg" alt="Join our Discord" />
  </a>
  <a href="https://github.com/vendurehq/vendure/blob/master/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome." />
  </a>
</p>

## What is Vendure Core

Vendure Core is the open-source TypeScript backend that powers [Vendure](https://vendure.io), the enterprise commerce platform. One coherent, extensible backend for catalog, orders, pricing, promotions, and customers in one place, so teams don't have to choose between rigid SaaS and assembling a DIY stack of services.

- **Plugin architecture, no forks required**: Extend or override any part of the system through stable plugin contracts. Customise the edges without patching the core.
- **TypeScript, Node.js, NestJS, GraphQL**: A coherent stack with strong types end to end, a large ecosystem, no proprietary query language, and agent-ready APIs that work with your developers' AI tools.
- **One backend, every channel**: A single extensible core serves any frontend or channel through a GraphQL API, so you avoid stitching together separate commerce services.
- **Production-tested at scale**: Used in production by enterprise teams. Plugin contracts give you safe extension points without patching core.
- **Built-in commerce building blocks**: Catalog, orders, customers, promotions, channels, tax, shipping, payments, and stock, with the primitives teams need from day one.

## What's in this repo

Vendure is a Lerna monorepo. The packages you'll touch most:

- **`@vendure/core`**: the framework itself. Entities, services, GraphQL APIs, the plugin system.
- **`@vendure/create`**: `npx @vendure/create` scaffolds a new project.
- **`@vendure/dashboard`**: the React-based admin dashboard.
- **`@vendure/cli`**: dev tooling for generating plugins, migrations, etc.
- **Official plugins**: `email-plugin`, `asset-server-plugin`, `job-queue-plugin`, `harden-plugin`, `telemetry-plugin`, `graphiql-plugin`.
- **`@vendure/testing`**: e2e test harness with a programmable mock server.

Runs on any Node.js host: self-hosted, Docker, Kubernetes, or any cloud. Managed hosting is available via [Vendure Cloud](https://vendure.io/products/cloud).

## Getting started

Visit our [Getting Started guide](https://docs.vendure.io/guides/getting-started/installation/) to spin up Vendure Core locally with a single command.

Questions? Join [our Discord](https://www.vendure.io/community) for support and discussions.

## Contribution

Contributions are welcome: bugs, features, or docs. Our **[Contribution Guide](./CONTRIBUTING.md)** covers everything from setting up your development environment to submitting your first pull request.

Pick up a [labelled issue](https://github.com/vendurehq/vendure/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22%F0%9F%91%8B%20contributions%20welcome%22) as a good first contribution.

## Upgrades & plugins

Patch releases ship regularly. Check our [release notes](https://github.com/vendurehq/vendure/releases) to keep up to date.

## License

Vendure Core is licensed under the [GPLv3 license](./LICENSE.md). To learn more about the full Vendure platform and cloud offering, see our [pricing page](https://vendure.io/pricing).

## Professional services

Need help getting your build to production? Our team offers [professional services](https://vendure.io/professional-services): architecture review, implementation support, and launch readiness from the people who build Vendure.
