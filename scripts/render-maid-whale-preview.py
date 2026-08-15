import bpy
import math
import os
import sys
from mathutils import Vector


def cli_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) not in (2, 4):
        raise SystemExit("usage: blender --background --python render-maid-whale-preview.py -- <model.glb> <output-dir> [action frame]")
    return os.path.abspath(args[0]), os.path.abspath(args[1]), *(args[2:] or (None, None))


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def imported_meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def world_bounds(objects):
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    low = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    high = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    return low, high


def look_at(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def add_lighting(center, size):
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.07, 0.11, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.30

    for name, location, energy, color, area_size in (
        ("Key", (-size, -size * 1.4, center.z + size), 320, (1.0, 0.91, 0.84), size * 1.5),
        ("Fill", (size * 1.3, -size * 0.5, center.z + size * 0.4), 210, (0.72, 0.84, 1.0), size * 1.3),
        ("Rim", (0, size * 1.5, center.z + size), 380, (0.55, 0.72, 1.0), size * 1.0),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = area_size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector(center) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_views(model_path, output_dir, action_name=None, frame=None):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=model_path)
    meshes = imported_meshes()
    if not meshes:
        raise RuntimeError("GLB contains no meshes")

    if action_name:
        rig = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
        action = bpy.data.actions.get(action_name)
        if not rig or not action:
            raise RuntimeError(f"missing rig or action: {action_name}; actions={[item.name for item in bpy.data.actions]}")
        rig.animation_data_create()
        for track in rig.animation_data.nla_tracks:
            track.mute = True
        rig.animation_data.action = action
        bpy.context.scene.frame_set(int(frame))
        bpy.context.view_layer.update()

    low, high = world_bounds(meshes)
    center = (low + high) * 0.5
    extent = high - low
    size = max(extent.x, extent.y, extent.z)

    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(extent.z * 1.12, max(extent.x, extent.y) * 1.35)
    camera.data.lens = 50
    bpy.context.scene.camera = camera

    add_lighting(center, size)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.65
    os.makedirs(output_dir, exist_ok=True)

    distance = size * 2.8
    views = {
        "front": (center.x, center.y - distance, center.z),
        "right": (center.x + distance, center.y, center.z),
        "back": (center.x, center.y + distance, center.z),
        "left": (center.x - distance, center.y, center.z),
    }
    for name, position in views.items():
        camera.location = position
        look_at(camera, center)
        scene.render.filepath = os.path.join(output_dir, f"{name}.png")
        bpy.ops.render.render(write_still=True)

    print(f"rendered {len(views)} views to {output_dir}")


if __name__ == "__main__":
    render_views(*cli_args())
