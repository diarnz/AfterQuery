/**
 * The run catalog is read from FastAPI's OpenAPI document, so the scenario and
 * policy lists always match the backend's RunRequest Literal types.
 */
import { z } from 'zod'

const enumProperty = z.object({
  enum: z.array(z.string()).min(1),
  default: z.string().optional(),
})

const seedProperty = z.object({
  anyOf: z.array(z.object({ type: z.string(), minimum: z.number().optional(), maximum: z.number().optional() })),
})

export const openApiRunRequestSchema = z.object({
  components: z.object({
    schemas: z.object({
      RunRequest: z.object({
        properties: z.object({
          scenario: enumProperty,
          policy: enumProperty,
          seed: seedProperty,
        }),
      }),
    }),
  }),
})

export interface RunCatalog {
  scenarios: string[]
  policies: string[]
  defaultScenario: string
  defaultPolicy: string
  seedMin: number
  seedMax: number
}

export interface RunRequest {
  scenario: string
  policy: string
  seed: number | null
}

/** The fixture uses the hand-computed Appendix G manifest and ignores the seed. */
export const FIXED_SCENARIOS: ReadonlySet<string> = new Set(['fixture'])

export function catalogFromOpenApi(document: unknown): RunCatalog {
  const parsed = openApiRunRequestSchema.parse(document)
  const { scenario, policy, seed } = parsed.components.schemas.RunRequest.properties
  const integer = seed.anyOf.find((option) => option.type === 'integer')
  if (!integer || integer.minimum === undefined || integer.maximum === undefined) {
    throw new Error('The API does not describe a bounded integer seed.')
  }
  return {
    scenarios: scenario.enum,
    policies: policy.enum,
    defaultScenario: scenario.default && scenario.enum.includes(scenario.default) ? scenario.default : scenario.enum[0] ?? '',
    defaultPolicy: policy.default && policy.enum.includes(policy.default) ? policy.default : policy.enum[0] ?? '',
    seedMin: integer.minimum,
    seedMax: integer.maximum,
  }
}
