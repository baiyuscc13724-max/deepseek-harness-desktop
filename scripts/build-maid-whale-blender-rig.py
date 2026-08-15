import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_DIR = os.path.join(ROOT, "renderer", "pets", "maid-whale", "model")
OUTPUT_BLEND = os.path.join(OUTPUT_DIR, "maid-whale-rig.blend")
OUTPUT_GLB = os.path.join(OUTPUT_DIR, "maid-whale-rig.glb")


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def color(hex_color):
    value = hex_color.lstrip("#")
    return tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)) + (1.0,)


def material(name, hex_color, roughness=0.7, metallic=0.0):
    item = bpy.data.materials.new(name)
    item.diffuse_color = color(hex_color)
    item.use_nodes = True
    shader = item.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color(hex_color)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return item


def make_palette():
    return {
        "skin": material("Skin", "#F7D8C5"),
        "hair": material("DeepOceanHair", "#243B78", 0.55),
        "hair_light": material("OceanHairHighlight", "#4B78BD", 0.5),
        "dress": material("MaidDress", "#1F356F"),
        "dress_light": material("DressRibbon", "#547FC4", 0.58),
        "white": material("MaidWhite", "#F7F8FC", 0.76),
        "eye_white": material("EyeWhite", "#FFFFFF", 0.42),
        "eye_blue": material("EyeBlue", "#4E8FE8", 0.36),
        "pupil": material("Pupil", "#101F50", 0.4),
        "mouth": material("Mouth", "#B95367"),
        "gold": material("GoldTrim", "#E4B95F", 0.32, 0.25),
        "shoe": material("Shoes", "#14234D", 0.42),
    }


def finish_part(obj, mat, bone_name, parts):
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    parts.append(obj)
    return obj


def sphere(parts, name, location, scale, mat, bone_name, rotation=None, segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    if rotation:
        obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_part(obj, mat, bone_name, parts)


def cone(parts, name, location, radius_bottom, radius_top, depth, mat, bone_name):
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=radius_bottom, radius2=radius_top, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    return finish_part(obj, mat, bone_name, parts)


def torus(parts, name, location, major_radius, minor_radius, mat, bone_name, scale=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=12, major_radius=major_radius, minor_radius=minor_radius, location=location)
    obj = bpy.context.object
    obj.name = name
    if scale:
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_part(obj, mat, bone_name, parts)


def capsule(parts, name, start, end, radius, mat, bone_name):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    midpoint = (start + end) * 0.5
    obj = sphere(parts, name, midpoint, (radius, radius, max(radius, direction.length * 0.58)), mat, bone_name, segments=28, rings=18)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def make_armature():
    armature = bpy.data.armatures.new("MaidWhaleArmature")
    rig = bpy.data.objects.new("MaidWhaleRig", armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def add(name, head, tail, parent=None, connected=False):
        item = armature.edit_bones.new(name)
        item.head, item.tail = Vector(head), Vector(tail)
        if parent:
            item.parent = armature.edit_bones.get(parent)
            item.use_connect = connected

    add("root", (0, 0, 0.18), (0, 0, 0.62))
    add("spine", (0, 0, 0.62), (0, 0, 1.15), "root", True)
    add("head", (0, 0, 1.15), (0, 0, 1.90), "spine", True)
    add("arm.L", (-0.34, 0, 1.08), (-0.58, 0, 0.76), "spine")
    add("forearm.L", (-0.58, 0, 0.76), (-0.69, -0.02, 0.46), "arm.L", True)
    add("arm.R", (0.34, 0, 1.08), (0.58, 0, 0.76), "spine")
    add("forearm.R", (0.58, 0, 0.76), (0.69, -0.02, 0.46), "arm.R", True)
    add("leg.L", (-0.20, 0, 0.43), (-0.21, 0, 0.05), "root")
    add("foot.L", (-0.21, 0, 0.05), (-0.21, -0.22, -0.10), "leg.L", True)
    add("leg.R", (0.20, 0, 0.43), (0.21, 0, 0.05), "root")
    add("foot.R", (0.21, 0, 0.05), (0.21, -0.22, -0.10), "leg.R", True)
    add("tail.01", (0.42, 0.10, 0.56), (0.72, 0.12, 0.72), "root")
    add("tail.02", (0.72, 0.12, 0.72), (0.91, 0.10, 1.00), "tail.01", True)
    add("tail.03", (0.91, 0.10, 1.00), (0.80, 0.08, 1.28), "tail.02", True)
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    return rig


def build_character(p):
    parts = []
    sphere(parts, "Torso", (0, 0, 0.92), (0.36, 0.27, 0.43), p["dress"], "spine")
    cone(parts, "Skirt", (0, 0, 0.51), 0.58, 0.32, 0.68, p["dress"], "root")
    torus(parts, "SkirtHem", (0, 0, 0.18), 0.48, 0.055, p["white"], "root", (1.0, 0.78, 1.0))
    sphere(parts, "Apron", (0, -0.31, 0.59), (0.37, 0.055, 0.40), p["white"], "root")
    sphere(parts, "ApronBadge", (0, -0.375, 0.61), (0.095, 0.025, 0.075), p["dress_light"], "root")
    sphere(parts, "Collar", (0, -0.20, 1.13), (0.35, 0.08, 0.10), p["white"], "spine")
    sphere(parts, "BowLeft", (-0.11, -0.34, 1.08), (0.14, 0.045, 0.085), p["dress_light"], "spine", (0, 0.22, -0.2))
    sphere(parts, "BowRight", (0.11, -0.34, 1.08), (0.14, 0.045, 0.085), p["dress_light"], "spine", (0, -0.22, 0.2))
    sphere(parts, "BowGem", (0, -0.39, 1.08), (0.055, 0.025, 0.055), p["gold"], "spine")

    capsule(parts, "UpperArmL", (-0.34, 0, 1.08), (-0.58, 0, 0.76), 0.105, p["dress"], "arm.L")
    capsule(parts, "ForearmL", (-0.58, 0, 0.76), (-0.69, -0.02, 0.46), 0.095, p["dress"], "forearm.L")
    sphere(parts, "CuffL", (-0.66, -0.02, 0.52), (0.14, 0.12, 0.09), p["white"], "forearm.L")
    sphere(parts, "HandL", (-0.70, -0.03, 0.40), (0.105, 0.09, 0.12), p["skin"], "forearm.L")
    capsule(parts, "UpperArmR", (0.34, 0, 1.08), (0.58, 0, 0.76), 0.105, p["dress"], "arm.R")
    capsule(parts, "ForearmR", (0.58, 0, 0.76), (0.69, -0.02, 0.46), 0.095, p["dress"], "forearm.R")
    sphere(parts, "CuffR", (0.66, -0.02, 0.52), (0.14, 0.12, 0.09), p["white"], "forearm.R")
    sphere(parts, "HandR", (0.70, -0.03, 0.40), (0.105, 0.09, 0.12), p["skin"], "forearm.R")
    capsule(parts, "LegL", (-0.20, 0, 0.43), (-0.21, 0, 0.02), 0.115, p["skin"], "leg.L")
    capsule(parts, "LegR", (0.20, 0, 0.43), (0.21, 0, 0.02), 0.115, p["skin"], "leg.R")
    sphere(parts, "SockL", (-0.21, -0.01, 0.09), (0.14, 0.13, 0.16), p["white"], "leg.L")
    sphere(parts, "SockR", (0.21, -0.01, 0.09), (0.14, 0.13, 0.16), p["white"], "leg.R")
    sphere(parts, "ShoeL", (-0.21, -0.16, -0.09), (0.18, 0.27, 0.13), p["shoe"], "foot.L")
    sphere(parts, "ShoeR", (0.21, -0.16, -0.09), (0.18, 0.27, 0.13), p["shoe"], "foot.R")

    sphere(parts, "HairBack", (0, 0.05, 1.70), (0.77, 0.64, 0.77), p["hair"], "head", segments=48, rings=28)
    sphere(parts, "Face", (0, -0.27, 1.68), (0.64, 0.58, 0.61), p["skin"], "head", segments=48, rings=28)
    sphere(parts, "HairLockL", (-0.58, 0.02, 1.23), (0.22, 0.22, 0.55), p["hair"], "head", (0.06, -0.18, -0.18))
    sphere(parts, "HairLockR", (0.58, 0.02, 1.23), (0.22, 0.22, 0.55), p["hair"], "head", (0.06, 0.18, 0.18))
    sphere(parts, "WhaleEarL", (-0.76, 0.02, 1.70), (0.28, 0.13, 0.25), p["hair_light"], "head", (0.1, -0.2, -0.28))
    sphere(parts, "WhaleEarR", (0.76, 0.02, 1.70), (0.28, 0.13, 0.25), p["hair_light"], "head", (0.1, 0.2, 0.28))
    for index, x in enumerate((-0.43, -0.22, 0, 0.22, 0.43)):
        sphere(parts, f"Fringe{index}", (x, -0.70, 2.06 - abs(x) * 0.18), (0.18, 0.10, 0.30), p["hair"], "head", (0.08, 0, x * -0.35))
    for index, degrees in enumerate(range(25, 156, 16)):
        angle = math.radians(degrees)
        sphere(parts, f"Bonnet{index}", (0.62 * math.cos(angle), -0.10, 1.98 + 0.49 * math.sin(angle)), (0.135, 0.11, 0.12), p["white"], "head", segments=24, rings=14)
    sphere(parts, "BonnetRibbon", (0, -0.08, 2.34), (0.42, 0.12, 0.13), p["white"], "head")

    for side, x in (("L", -0.24), ("R", 0.24)):
        sphere(parts, f"EyeWhite{side}", (x, -0.79, 1.72), (0.145, 0.055, 0.19), p["eye_white"], "head")
        sphere(parts, f"Iris{side}", (x, -0.845, 1.70), (0.095, 0.025, 0.14), p["eye_blue"], "head")
        sphere(parts, f"Pupil{side}", (x, -0.873, 1.69), (0.045, 0.014, 0.085), p["pupil"], "head", segments=24, rings=14)
        sphere(parts, f"EyeShine{side}", (x - 0.028, -0.889, 1.75), (0.022, 0.008, 0.035), p["white"], "head", segments=18, rings=10)
    sphere(parts, "Mouth", (0, -0.855, 1.48), (0.075, 0.018, 0.038), p["mouth"], "head", segments=24, rings=12)

    capsule(parts, "TailBase", (0.42, 0.10, 0.56), (0.72, 0.12, 0.72), 0.15, p["hair_light"], "tail.01")
    capsule(parts, "TailMid", (0.72, 0.12, 0.72), (0.91, 0.10, 1.00), 0.14, p["hair_light"], "tail.02")
    capsule(parts, "TailTip", (0.91, 0.10, 1.00), (0.80, 0.08, 1.28), 0.13, p["hair_light"], "tail.03")
    sphere(parts, "TailFlukeTop", (0.76, 0.07, 1.36), (0.29, 0.11, 0.15), p["hair_light"], "tail.03", (0, -0.2, 0.5))
    sphere(parts, "TailFlukeBottom", (0.91, 0.08, 1.30), (0.27, 0.11, 0.14), p["hair_light"], "tail.03", (0, 0.2, -0.45))
    return parts


def bind_parts(parts, rig):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    mesh = bpy.context.object
    mesh.name = "MaidWhale3D"
    modifier = mesh.modifiers.new("MaidWhaleArmature", "ARMATURE")
    modifier.object = rig
    mesh.parent = rig
    return mesh


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_euler = (0, 0, 0)
        bone.location = (0, 0, 0)
        bone.scale = (1, 1, 1)


def pose(rig, frame, rotations=None, locations=None, scales=None):
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


def action(rig, name, builder):
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
    action(rig, "Idle", lambda r: (
        pose(r, 0, {"spine": (0, 0, -2), "head": (1, 0, 2), "tail.01": (0, -7, 4), "tail.02": (0, 10, -5)}),
        pose(r, 18, {"spine": (0, 0, 2), "head": (-2, 0, -2), "tail.01": (0, 9, -5), "tail.02": (0, -12, 7)}, scales={"spine": (1, 1, 1.03)}),
        pose(r, 36, {"spine": (0, 0, -2), "head": (1, 0, 2), "tail.01": (0, -7, 4), "tail.02": (0, 10, -5)}),
    ))
    action(rig, "Walk", lambda r: (
        pose(r, 0, {"spine": (0, 0, -3), "head": (2, 0, 3), "leg.L": (32, 0, 0), "foot.L": (-15, 0, 0), "leg.R": (-32, 0, 0), "foot.R": (15, 0, 0), "arm.L": (-27, 0, 0), "forearm.L": (-10, 0, 0), "arm.R": (27, 0, 0), "forearm.R": (10, 0, 0), "tail.01": (0, -15, 4), "tail.02": (0, 18, -5)}),
        pose(r, 6, {"leg.L": (0, 0, 0), "leg.R": (0, 0, 0), "arm.L": (0, 0, 0), "arm.R": (0, 0, 0)}, {"root": (0, 0, 0.09)}, {"spine": (1, 1, 1.035)}),
        pose(r, 12, {"spine": (0, 0, 3), "head": (2, 0, -3), "leg.L": (-32, 0, 0), "foot.L": (15, 0, 0), "leg.R": (32, 0, 0), "foot.R": (-15, 0, 0), "arm.L": (27, 0, 0), "forearm.L": (10, 0, 0), "arm.R": (-27, 0, 0), "forearm.R": (-10, 0, 0), "tail.01": (0, 15, -4), "tail.02": (0, -18, 5)}),
        pose(r, 18, {"leg.L": (0, 0, 0), "leg.R": (0, 0, 0), "arm.L": (0, 0, 0), "arm.R": (0, 0, 0)}, {"root": (0, 0, 0.09)}, {"spine": (1, 1, 1.035)}),
        pose(r, 24, {"spine": (0, 0, -3), "head": (2, 0, 3), "leg.L": (32, 0, 0), "foot.L": (-15, 0, 0), "leg.R": (-32, 0, 0), "foot.R": (15, 0, 0), "arm.L": (-27, 0, 0), "forearm.L": (-10, 0, 0), "arm.R": (27, 0, 0), "forearm.R": (10, 0, 0), "tail.01": (0, -15, 4), "tail.02": (0, 18, -5)}),
    ))
    action(rig, "Drag", lambda r: (pose(r, 0, {"root": (0, 0, -5), "arm.L": (0, -62, -15), "arm.R": (0, 62, 15)}), pose(r, 12, {"root": (0, 0, 5), "arm.L": (0, -75, -20), "arm.R": (0, 75, 20)}), pose(r, 24, {"root": (0, 0, -5), "arm.L": (0, -62, -15), "arm.R": (0, 62, 15)})))
    action(rig, "Fall", lambda r: (pose(r, 0, {"root": (0, 0, 0)}), pose(r, 12, {"root": (0, 0, -150)}), pose(r, 24, {"root": (0, 0, -330)})))
    action(rig, "EatTOK", lambda r: (pose(r, 0), pose(r, 10, {"head": (10, 0, 0), "arm.L": (-55, -20, 0), "arm.R": (-55, 20, 0)}), pose(r, 20, {"head": (-8, 0, 0), "arm.L": (-45, -15, 0), "arm.R": (-45, 15, 0)}), pose(r, 30, {"head": (10, 0, 0), "arm.L": (-55, -20, 0), "arm.R": (-55, 20, 0)}), pose(r, 40, {"head": (0, 0, 0), "arm.L": (0, 0, 0), "arm.R": (0, 0, 0)})))
    action(rig, "Celebrate", lambda r: (pose(r, 0, locations={"root": (0, 0, 0)}), pose(r, 12, {"root": (0, 0, -8), "arm.L": (0, -105, -18), "arm.R": (0, 105, 18), "head": (0, 0, 8)}, {"root": (0, 0, 0.13)}), pose(r, 24, {"root": (0, 0, 8), "arm.L": (0, -82, -12), "arm.R": (0, 82, 12), "head": (0, 0, -8)}), pose(r, 36, {"root": (0, 0, -8), "arm.L": (0, -105, -18), "arm.R": (0, 105, 18), "head": (0, 0, 8)}, {"root": (0, 0, 0.13)}), pose(r, 48, {"root": (0, 0, 0), "arm.L": (0, 0, 0), "arm.R": (0, 0, 0), "head": (0, 0, 0)})))
    reset_pose(rig)


def export(rig, mesh):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = 48
    bpy.context.scene.render.fps = 30
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    options = dict(filepath=OUTPUT_GLB, export_format="GLB", use_selection=True, export_animations=True, export_skins=True, export_morph=False, export_materials="EXPORT")
    try:
        bpy.ops.export_scene.gltf(**options, export_animation_mode="NLA_TRACKS")
    except TypeError:
        bpy.ops.export_scene.gltf(**options)
    print(f"BLEND={OUTPUT_BLEND}")
    print(f"GLB={OUTPUT_GLB}")


clear_scene()
rig = make_armature()
mesh = bind_parts(build_character(make_palette()), rig)
make_animations(rig)
export(rig, mesh)
