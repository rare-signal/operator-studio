/**
 * Seeds the first two Software Factory rows:
 *   - factory-clarifying-telegento  (the JSA / TeleGento lane)
 *   - factory-operator-studio       (Operator Studio meta-work)
 *
 * Idempotent — re-runs replace by id.
 */

import { upsertFactory } from "../lib/operator-studio/factories"
import { getPgPool } from "../lib/server/db/client"

const workspaceId = "global"

async function main() {
  await upsertFactory({
    id: "factory-clarifying-telegento",
    workspaceId,
    label: "Clarifying Media Group → Telegento",
    orgName: "Clarifying Media Group",
    productName: "Telegento",
    productRepoPath: "/Users/smackbook/nextgen-call-intelligence-shell",
    productProdUrl: "https://app.telegento.com",
    commsSubstrates: [
      {
        kind: "ado",
        details: {
          organization: "https://dev.azure.com/ClarifyingMarketingGroup",
          project: "IT",
          auth: "az CLI",
        },
      },
      {
        kind: "teams",
        details: {
          tenant: "ClarifyingMarketingGroup",
          authStatus: "Graph OAuth pending",
        },
      },
    ],
    systemMap: {
      aws: {
        codeBuildProject: "telegento-app-build",
        appRunnerArn:
          "arn:aws:apprunner:us-east-1:694973467292:service/telegento/0dac790a8d244b0a83764c1646cd44f1",
        appRunnerImage:
          "694973467292.dkr.ecr.us-east-1.amazonaws.com/telegento:latest",
        aurora: "infra/aurora-serverless.cfn.yml",
        lambdas: [
          "coaching-lambda",
          "digest-lambda",
          "enrichment-lambda",
          "insight-lambda",
          "missed-ops-grouping-lambda",
          "transcribe-lambda",
          "enrollhere-intake-lambda",
        ],
      },
      github: {
        repo: "davidlinc1/nextgen-call-intelligence-shell",
        deployBranch: "main",
        deployMechanism:
          "git push origin main → CodeBuild webhook → App Runner",
      },
    },
    escalationTargets: {
      ado: {
        defaultProject: "IT",
        commentAddressedTo: "creator + assignee",
      },
      teams: {
        priorityBumpRecipient: "Micky Sakora",
      },
    },
    audience: [
      {
        name: "David Lin Clark",
        identity: "dlclark@clarifying.com",
        role: "operator",
        notes:
          "Sole human-of-record for outbound. Per pattern-customer-of-many-via-david.",
      },
      {
        name: "Micky Sakora",
        identity: "msakora@clarifying.com",
        role: "engineering_manager",
        notes: "Owns Telegento priority. Comments are highest-weight signals.",
      },
      {
        name: "Rob",
        role: "stakeholder",
        notes: "Call-quality / disputable-call workflow SME.",
      },
    ],
    operatorNotes: [
      "All outbound (ADO comments / state changes / Teams posts) MUST flow",
      "through the outbox + outbound PIN gate. The 2026-05-08 ADO #39 anomaly",
      "is the rule break that drove this gate — do not repeat.",
    ].join(" "),
  })

  await upsertFactory({
    id: "factory-operator-studio",
    workspaceId,
    label: "Operator Studio (meta)",
    orgName: "Clarifying Media Group",
    productName: "Operator Studio",
    productRepoPath: "/Users/smackbook/operator-studio",
    // No productProdUrl — Operator Studio runs locally only.
    commsSubstrates: [],
    systemMap: {
      github: {
        repo: "(local-only — no production deploy)",
      },
      runtime: {
        dev: "next dev --port 4200",
        prodLocal: "next start --port 4201",
      },
    },
    escalationTargets: {},
    audience: [
      {
        name: "David Lin Clark",
        identity: "dlclark@clarifying.com",
        role: "operator",
      },
    ],
    operatorNotes: [
      "Self-host meta-factory: code edits to Operator Studio itself happen",
      "here. No external comms substrates — outbound is N/A.",
    ].join(" "),
  })

  console.log("Seeded 2 software factories.")
  await getPgPool().end()
}

main().catch(async (err) => {
  console.error(err)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
