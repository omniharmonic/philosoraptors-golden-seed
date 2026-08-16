import * as THREE from 'three';

/**
 * `lights` is a field on three's NodeMaterial (the WebGPU render path), not on
 * the core Material the TS typings describe, so it needs its own type.
 */
type SceneLitMaterial = THREE.Material & { lights?: boolean };

/**
 * Opt a material out of scene lighting, so it genuinely needs no vertex normals.
 *
 * WHY THIS EXISTS
 *
 * MeshBasicMaterial is unlit on WebGL2 — the shader never looks at a light.
 * On WebGPU it is not: the renderer swaps it for MeshBasicNodeMaterial, which
 * sets `lights = true`, so NodeMaterial.setupLighting() builds a lighting
 * context containing every light in the scene. Our scene has a HemisphereLight,
 * and HemisphereLightNode.setup() unconditionally evaluates
 * `normalView.dot(lightDirection)` to weight sky against ground. That pulls in
 * `attribute('normal')`, which makes TSL warn once per material built against a
 * geometry that has no normals:
 *
 *   TSL.NormalNode: Vertex attribute "normal" not found on geometry.
 *
 * The contribution is then thrown away: BasicLightingModel.indirect() ignores
 * `context.irradiance` entirely and assigns `indirectDiffuse = diffuseColor.rgb`,
 * which is exactly what `setupOutgoingLight()` returns when `lights` is false.
 * So for a basic material with no lightMap, envMap or aoMap the two paths are
 * bit-for-bit identical, and turning `lights` off removes a normal dependency
 * that only ever fed a discarded result.
 *
 * The flag reaches the node material because NodeLibrary.fromMaterial() copies
 * every enumerable key off the source material onto the node material it builds.
 *
 * On WebGL2 this is inert: WebGLRenderer's materialNeedsLights() only consults
 * `.lights` for ShaderMaterial, so a MeshBasicMaterial is unaffected. That is
 * why this needs no backend flag — it is correct on both paths.
 */
export function unlit<T extends THREE.Material>(material: T): T {
  (material as SceneLitMaterial).lights = false;
  return material;
}
