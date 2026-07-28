import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const outputDirectory = resolve(repositoryRoot, "apps/web/dist/subway-track-data");
const files = [
  "subway_geometry_sources.json",
  "subway_segment_shapes.geojson",
  "subway_segment_shapes.report.json",
  "subway_segment_shapes.LICENSE.md",
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  files.map((file) =>
    copyFile(
      resolve(repositoryRoot, "data", file),
      resolve(outputDirectory, file),
    ),
  ),
);
