// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

import bknDocumentManifest from "../templates/bkn/document/manifest.json" with { type: "json" };
import bknDocumentTemplate from "../templates/bkn/document/template.json" with { type: "json" };
import dataflowUnstructuredManifest from "../templates/dataflow/unstructured/manifest.json" with {
  type: "json",
};
import dataflowUnstructuredTemplate from "../templates/dataflow/unstructured/template.json" with {
  type: "json",
};
import datasetContentManifest from "../templates/dataset/document-content/manifest.json" with {
  type: "json",
};
import datasetContentTemplate from "../templates/dataset/document-content/template.json" with {
  type: "json",
};
import datasetElementManifest from "../templates/dataset/document-element/manifest.json" with {
  type: "json",
};
import datasetElementTemplate from "../templates/dataset/document-element/template.json" with {
  type: "json",
};
/**
 * Bundled dataflow/dataset/bkn templates + a renderer. Templates are config
 * assets (JSON) copied verbatim from the legacy templates; the rendering logic (merge
 * defaults → validate required → interpolate `{{arg}}`) is reimplemented here.
 * Used by `dataflow templates` / `create-dataset` / `create-bkn`.
 */
import datasetDocumentManifest from "../templates/dataset/document/manifest.json" with {
  type: "json",
};
import datasetDocumentTemplate from "../templates/dataset/document/template.json" with {
  type: "json",
};

export type TemplateType = "dataset" | "bkn" | "dataflow";

export interface TemplateArg {
  name: string;
  required?: boolean;
  description?: string;
  type?: string;
  default?: unknown;
}
export interface TemplateManifest {
  name: string;
  type: TemplateType;
  description?: string;
  arguments: TemplateArg[];
}
export interface LoadedTemplate {
  manifest: TemplateManifest;
  template: Record<string, unknown>;
}

const REGISTRY: Record<TemplateType, Record<string, LoadedTemplate>> = {
  dataset: {
    document: {
      manifest: datasetDocumentManifest as TemplateManifest,
      template: datasetDocumentTemplate as Record<string, unknown>,
    },
    "document-content": {
      manifest: datasetContentManifest as TemplateManifest,
      template: datasetContentTemplate as Record<string, unknown>,
    },
    "document-element": {
      manifest: datasetElementManifest as TemplateManifest,
      template: datasetElementTemplate as Record<string, unknown>,
    },
  },
  bkn: {
    document: {
      manifest: bknDocumentManifest as TemplateManifest,
      template: bknDocumentTemplate as Record<string, unknown>,
    },
  },
  dataflow: {
    unstructured: {
      manifest: dataflowUnstructuredManifest as TemplateManifest,
      template: dataflowUnstructuredTemplate as Record<string, unknown>,
    },
  },
};

export function loadTemplate(type: TemplateType, name: string): LoadedTemplate | null {
  return REGISTRY[type]?.[name] ?? null;
}

export function listTemplates(): Array<{
  type: TemplateType;
  name: string;
  description?: string;
  arguments: TemplateArg[];
}> {
  const out: Array<{
    type: TemplateType;
    name: string;
    description?: string;
    arguments: TemplateArg[];
  }> = [];
  for (const type of Object.keys(REGISTRY) as TemplateType[]) {
    for (const [name, t] of Object.entries(REGISTRY[type])) {
      out.push({
        type,
        name,
        description: t.manifest.description,
        arguments: t.manifest.arguments,
      });
    }
  }
  return out;
}

export function generateSourceIdentifier(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function interpolate(s: string, values: Record<string, unknown>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k) =>
    values[k] !== undefined ? String(values[k]) : `{{${k}}}`,
  );
}
function deepReplace(obj: unknown, values: Record<string, unknown>): unknown {
  if (typeof obj === "string") return interpolate(obj, values);
  if (Array.isArray(obj)) return obj.map((x) => deepReplace(x, values));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>))
      out[k] = deepReplace(v, values);
    return out;
  }
  return obj;
}

/** Merge args with manifest defaults, enforce required, then interpolate. */
export function renderTemplate(
  t: LoadedTemplate,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const arg of t.manifest.arguments) {
    if (args[arg.name] !== undefined) merged[arg.name] = args[arg.name];
    else if (arg.default !== undefined) merged[arg.name] = arg.default;
    else if (arg.required) missing.push(arg.name);
  }
  if (missing.length > 0) throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
  return deepReplace(t.template, merged) as Record<string, unknown>;
}
