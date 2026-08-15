import bpy
import math
import os
import sys
from mathutils import Vector


TARGET_HEIGHT = 3.0


def cli_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) != 3:
        raise SystemExit("usage: blender --background --python build-maid-whale-hunyuan-rig.py -- <source.glb> <output.blend> <output.glb>")
    return tuple(os.path.abspath(value) for value in args)


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bounds(objects):
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    low = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    high = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    return low, high


def import_and_normalize(source_path):
    bpy.ops.import_scene.gltf(filepath=source_path)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("source GLB contains no mesh")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.object
    mesh.name = "MaidWhaleMesh"

    low, high = bounds([mesh])
    scale = TARGET_HEIGHT / max(0.001, high.z - low.z)
    mesh.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    low, high = bounds([mesh])
    center = (low + high) * 0.5
    mesh.location += Vector((-center.x, -center.y, -low.z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    for polygon in mesh.data.polygons:
        polygon.use_smooth = True
    return mesh


def make_armature():
    armature = bpy.data.armatures.new("MaidWhaleArmature")
    rig = bpy.data.objects.new("MaidWhaleRig", armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def add(name, head, tail, parent=None, connected=False, deform=True):
        bone = armature.edit_bones.new(name)
        bone.head = Vector(head)
        bone.tail = Vector(tail)
        bone.use_deform = deform
        if parent:
            bone.parent = armature.edit_bones[parent]
            bone.use_connect = connected
        return bone

    h = TARGET_HEIGHT
    add("root", (0, 0, 0.04 * h), (0, 0, 0.13 * h))
    add("pelvis", (0, 0, 0.13 * h), (0, 0, 0.37 * h), "root", True)
    add("spine", (0, 0, 0.37 * h), (0, 0, 0.53 * h), "pelvis", True)
    add("chest", (0, 0, 0.53 * h), (0, 0, 0.66 * h), "spine", True)
    add("neck", (0, 0, 0.66 * h), (0, 0, 0.71 * h), "chest", True)
    add("head", (0, 0, 0.71 * h), (0, 0, 0.94 * h), "neck", True)

    for side, sign in (("L", -1), ("R", 1)):
        add(f"upper_arm.{side}", (sign * 0.16 * h, 0, 0.63 * h), (sign * 0.25 * h, 0, 0.50 * h), "chest")
        add(f"forearm.{side}", (sign * 0.25 * h, 0, 0.50 * h), (sign * 0.31 * h, -0.01 * h, 0.39 * h), f"upper_arm.{side}", True)
        add(f"hand.{side}", (sign * 0.31 * h, -0.01 * h, 0.39 * h), (sign * 0.34 * h, -0.02 * h, 0.35 * h), f"forearm.{side}", True)
        add(f"thigh.{side}", (sign * 0.085 * h, 0, 0.36 * h), (sign * 0.09 * h, 0, 0.20 * h), "pelvis")
        add(f"shin.{side}", (sign * 0.09 * h, 0, 0.20 * h), (sign * 0.09 * h, -0.005 * h, 0.065 * h), f"thigh.{side}", True)
        add(f"foot.{side}", (sign * 0.09 * h, -0.005 * h, 0.065 * h), (sign * 0.09 * h, -0.09 * h, 0.035 * h), f"shin.{side}", True)

    add("tail.01", (0.20 * h, 0.03 * h, 0.36 * h), (0.36 * h, 0.03 * h, 0.35 * h), "pelvis")
    add("tail.02", (0.36 * h, 0.03 * h, 0.35 * h), (0.49 * h, 0.02 * h, 0.43 * h), "tail.01", True)
    add("tail.03", (0.49 * h, 0.02 * h, 0.43 * h), (0.53 * h, 0.01 * h, 0.58 * h), "tail.02", True)

    bpy.ops.object.mode_set(mode="POSE")
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def bind(mesh, rig):
    mesh.vertex_groups.clear()
    bones = {bone.name: bone for bone in rig.data.bones if bone.use_deform}
    groups = {name: mesh.vertex_groups.new(name=name) for name in bones}

    def point_segment_distance(point, bone):
        start = bone.head_local
        segment = bone.tail_local - start
        length_squared = max(segment.length_squared, 1e-8)
        amount = max(0.0, min(1.0, (point - start).dot(segment) / length_squared))
        return (point - (start + segment * amount)).length

    def candidates(point):
        x, y, z = point
        # The whale tail is behind the right side of the skirt in the source pose.
        if x > 0.54 and y > -0.08 and 0.72 < z < 1.82:
            if x < 1.05:
                return ("tail.01",)
            if z < 1.42:
                return ("tail.02",)
            return ("tail.03",)
        # Keep long back-hair attached to the head instead of the nearby arms.
        if z > 1.90 or (z > 1.36 and y > 0.10):
            return ("head",)
        if z < 1.15 and abs(x) < 0.34:
            side = "L" if x < 0 else "R"
            if z < 0.30:
                return (f"foot.{side}",)
            if z < 0.70:
                return (f"shin.{side}",)
            return (f"thigh.{side}",)
        if 1.05 < z < 1.95 and abs(x) > 0.30 and y < 0.13:
            side = "L" if x < 0 else "R"
            if z < 1.18:
                return (f"hand.{side}",)
            if z < 1.50:
                return (f"forearm.{side}",)
            return (f"upper_arm.{side}",)
        if z < 1.12:
            return ("pelvis",)
        if z < 1.52:
            return ("spine",)
        if z < 1.92:
            return ("chest",)
        return ("head",)

    # Quantized two-bone weights avoid hundreds of thousands of one-vertex API calls.
    buckets = {}
    for vertex in mesh.data.vertices:
        choices = sorted(
            ((point_segment_distance(vertex.co, bones[name]), name) for name in candidates(vertex.co)),
            key=lambda item: item[0],
        )[:2]
        inverse = [1.0 / max(distance, 0.025) ** 3 for distance, _ in choices]
        total = sum(inverse)
        for (_, name), raw_weight in zip(choices, inverse):
            weight = raw_weight / total
            bucket = max(1, min(20, round(weight * 20)))
            buckets.setdefault((name, bucket), []).append(vertex.index)
    for (name, bucket), indices in buckets.items():
        groups[name].add(indices, bucket / 20.0, "REPLACE")

    modifier = mesh.modifiers.new("MaidWhaleArmature", "ARMATURE")
    modifier.object = rig
    mesh.parent = rig
    print(f"assigned custom skin weights to {len(mesh.data.vertices)} vertices")


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_euler = (0, 0, 0)
        bone.location = (0, 0, 0)
        bone.scale = (1, 1, 1)


def key_pose(rig, frame, rotations=None, locations=None, scales=None):
    for name, degrees in (rotations or {}).items():
        bone = rig.pose.bones[name]
        bone.rotation_euler = tuple(math.radians(value) for value in degrees)
        bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=name)
    for name, location in (locations or {}).items():
        bone = rig.pose.bones[name]
        bone.location = location
        bone.keyframe_insert(data_path="location", frame=frame, group=name)
    for name, value in (scales or {}).items():
        bone = rig.pose.bones[name]
        bone.scale = value
        bone.keyframe_insert(data_path="scale", frame=frame, group=name)


def add_action(rig, name, builder):
    reset_pose(rig)
    clip = bpy.data.actions.new(name=name)
    rig.animation_data_create()
    rig.animation_data.action = clip
    builder(rig)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, clip)
    rig.animation_data.action = None


def make_animations(rig):
    add_action(rig, "Idle", lambda r: (
        key_pose(r, 0, {"spine": (0, 0, -1.5), "head": (1, 0, 1.5), "tail.01": (0, -7, 4), "tail.02": (0, 10, -5)}),
        key_pose(r, 18, {"spine": (0, 0, 1.5), "head": (-1.5, 0, -1.5), "tail.01": (0, 9, -5), "tail.02": (0, -12, 7)}, scales={"chest": (1, 1, 1.025)}),
        key_pose(r, 36, {"spine": (0, 0, -1.5), "head": (1, 0, 1.5), "tail.01": (0, -7, 4), "tail.02": (0, 10, -5)}),
    ))
    add_action(rig, "Walk", lambda r: (
        key_pose(r, 0, {"spine": (0, 0, -1.5), "thigh.L": (18, 0, 0), "shin.L": (-7, 0, 0), "thigh.R": (-18, 0, 0), "shin.R": (9, 0, 0), "upper_arm.L": (-12, 0, 0), "upper_arm.R": (12, 0, 0), "tail.01": (0, -10, 3), "tail.02": (0, 13, -4)}),
        key_pose(r, 6, locations={"root": (0, 0, 0.07)}),
        key_pose(r, 12, {"spine": (0, 0, 1.5), "thigh.L": (-18, 0, 0), "shin.L": (9, 0, 0), "thigh.R": (18, 0, 0), "shin.R": (-7, 0, 0), "upper_arm.L": (12, 0, 0), "upper_arm.R": (-12, 0, 0), "tail.01": (0, 10, -3), "tail.02": (0, -13, 4)}),
        key_pose(r, 18, locations={"root": (0, 0, 0.07)}),
        key_pose(r, 24, {"spine": (0, 0, -1.5), "thigh.L": (18, 0, 0), "shin.L": (-7, 0, 0), "thigh.R": (-18, 0, 0), "shin.R": (9, 0, 0), "upper_arm.L": (-12, 0, 0), "upper_arm.R": (12, 0, 0), "tail.01": (0, -10, 3), "tail.02": (0, 13, -4)}),
    ))
    add_action(rig, "Drag", lambda r: (
        key_pose(r, 0, {"root": (0, 0, -4), "upper_arm.L": (0, -58, -8), "upper_arm.R": (0, 58, 8), "forearm.L": (0, -24, 0), "forearm.R": (0, 24, 0)}),
        key_pose(r, 12, {"root": (0, 0, 4), "upper_arm.L": (0, -72, -12), "upper_arm.R": (0, 72, 12)}),
        key_pose(r, 24, {"root": (0, 0, -4), "upper_arm.L": (0, -58, -8), "upper_arm.R": (0, 58, 8)}),
    ))
    add_action(rig, "Fall", lambda r: (
        key_pose(r, 0),
        key_pose(r, 12, {"root": (0, 0, -80)}),
        key_pose(r, 24, {"root": (0, 0, -185)}),
    ))
    add_action(rig, "EatTOK", lambda r: (
        key_pose(r, 0),
        key_pose(r, 10, {"head": (8, 0, 0), "upper_arm.L": (-50, -18, 0), "upper_arm.R": (-50, 18, 0), "forearm.L": (-38, 0, 0), "forearm.R": (-38, 0, 0)}),
        key_pose(r, 20, {"head": (-7, 0, 0), "upper_arm.L": (-43, -14, 0), "upper_arm.R": (-43, 14, 0)}),
        key_pose(r, 30, {"head": (8, 0, 0), "upper_arm.L": (-50, -18, 0), "upper_arm.R": (-50, 18, 0)}),
        key_pose(r, 40),
    ))
    add_action(rig, "Celebrate", lambda r: (
        key_pose(r, 0),
        key_pose(r, 12, {"root": (0, 0, -7), "upper_arm.L": (0, -105, -15), "upper_arm.R": (0, 105, 15), "head": (0, 0, 8)}, locations={"root": (0, 0, 0.12)}),
        key_pose(r, 24, {"root": (0, 0, 7), "upper_arm.L": (0, -78, -10), "upper_arm.R": (0, 78, 10), "head": (0, 0, -8)}),
        key_pose(r, 36, {"root": (0, 0, -7), "upper_arm.L": (0, -105, -15), "upper_arm.R": (0, 105, 15), "head": (0, 0, 8)}, locations={"root": (0, 0, 0.12)}),
        key_pose(r, 48),
    ))
    reset_pose(rig)


def save_and_export(rig, mesh, blend_path, glb_path):
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    os.makedirs(os.path.dirname(glb_path), exist_ok=True)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = 48
    scene.render.fps = 30
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    options = dict(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_skins=True,
        export_morph=True,
        export_materials="EXPORT",
    )
    try:
        bpy.ops.export_scene.gltf(**options, export_animation_mode="NLA_TRACKS")
    except TypeError:
        bpy.ops.export_scene.gltf(**options)
    print(f"BLEND={blend_path}")
    print(f"GLB={glb_path}")


def main():
    source_path, blend_path, glb_path = cli_args()
    clear_scene()
    mesh = import_and_normalize(source_path)
    rig = make_armature()
    bind(mesh, rig)
    make_animations(rig)
    save_and_export(rig, mesh, blend_path, glb_path)


if __name__ == "__main__":
    main()
