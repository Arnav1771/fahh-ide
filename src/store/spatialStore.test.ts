import { describe, it, expect, beforeEach } from "vitest";
import { useSpatialStore, calculateCenterPan } from "./spatialStore";

describe("spatialStore", () => {
  beforeEach(() => {
    useSpatialStore.getState().resetView();
  });

  it("initializes with 1.0 zoom (100% sharp text) to prevent rasterization blur", () => {
    const { zoom } = useSpatialStore.getState();
    expect(zoom).toBe(1.0);
  });

  it("calculates center pan positioning node in the center of viewport", () => {
    const pan = calculateCenterPan({ x: 510, y: 80, w: 960, h: 660 }, 1440, 900);
    // targetX = 1440 / 2 - (510 + 480) = 720 - 990 = -270
    expect(pan.x).toBe(-270);
    // targetY = 900 / 2 - (80 + 330) = 450 - 410 = 40
    expect(pan.y).toBe(40);
  });

  it("resets view to 1.0 zoom and centers spatial-editor", () => {
    const store = useSpatialStore.getState();
    store.setZoom(0.5);
    store.setPan({ x: 1000, y: 1000 });

    store.resetView();

    const stateAfter = useSpatialStore.getState();
    expect(stateAfter.zoom).toBe(1.0);
    expect(stateAfter.pan.x).toBeDefined();
    expect(stateAfter.pan.y).toBeDefined();
  });

  it("focuses a specific node at 1.0 zoom and sets it active", () => {
    const store = useSpatialStore.getState();
    store.setZoom(0.7);

    store.focusNode("spatial-editor");

    const stateAfter = useSpatialStore.getState();
    expect(stateAfter.zoom).toBe(1.0);
    expect(stateAfter.activeNodeId).toBe("spatial-editor");
  });

  it("clamps zoom within safe bounds", () => {
    const store = useSpatialStore.getState();
    store.setZoom(5.0);
    expect(useSpatialStore.getState().zoom).toBe(2.0);

    store.setZoom(0.1);
    expect(useSpatialStore.getState().zoom).toBe(0.3);
  });
});
