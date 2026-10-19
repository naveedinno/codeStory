use std::{
    fs::File,
    io::BufWriter,
    path::{Path, PathBuf},
};

fn rounded_rect(x: f32, y: f32) -> bool {
    let edge = 56.0;
    let far = 968.0;
    let radius = 224.0;
    if (edge + radius..=far - radius).contains(&x) && (edge..=far).contains(&y) {
        return true;
    }
    if (edge + radius..=far - radius).contains(&y) && (edge..=far).contains(&x) {
        return true;
    }
    let cx = if x < edge + radius {
        edge + radius
    } else {
        far - radius
    };
    let cy = if y < edge + radius {
        edge + radius
    } else {
        far - radius
    };
    (x - cx).powi(2) + (y - cy).powi(2) <= radius.powi(2)
}

fn distance_to_segment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let dx = bx - ax;
    let dy = by - ay;
    let length_squared = dx * dx + dy * dy;
    let t = (((px - ax) * dx + (py - ay) * dy) / length_squared).clamp(0.0, 1.0);
    let x = ax + t * dx;
    let y = ay + t * dy;
    ((px - x).powi(2) + (py - y).powi(2)).sqrt()
}

fn mark_pixel(x: f32, y: f32) -> Option<[u8; 4]> {
    let nodes = [(368.0, 336.0), (600.0, 528.0), (656.0, 730.0)];
    for (index, (cx, cy)) in nodes.iter().enumerate() {
        if (x - cx).powi(2) + (y - cy).powi(2) <= 62.0_f32.powi(2) {
            return Some(if index == 1 {
                [214, 233, 255, 255]
            } else {
                [255, 255, 255, 255]
            });
        }
    }

    let segments = [
        (368.0, 336.0, 600.0, 336.0),
        (600.0, 336.0, 600.0, 528.0),
        (600.0, 528.0, 426.0, 528.0),
        (426.0, 528.0, 426.0, 730.0),
        (426.0, 730.0, 656.0, 730.0),
    ];
    if segments
        .iter()
        .any(|&(ax, ay, bx, by)| distance_to_segment(x, y, ax, ay, bx, by) <= 35.0)
    {
        Some([255, 255, 255, 255])
    } else {
        None
    }
}

fn generate_icon() {
    const SIZE: u32 = 1024;
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let icon_dir = manifest.join("icons");
    std::fs::create_dir_all(&icon_dir).unwrap();
    let mut pixels = vec![0_u8; (SIZE * SIZE * 4) as usize];

    for y in 0..SIZE {
        for x in 0..SIZE {
            let xf = x as f32 + 0.5;
            let yf = y as f32 + 0.5;
            let offset = ((y * SIZE + x) * 4) as usize;
            if rounded_rect(xf, yf) {
                pixels[offset..offset + 4].copy_from_slice(&[0, 122, 255, 255]);
            }
            if let Some(color) = mark_pixel(xf, yf) {
                pixels[offset..offset + 4].copy_from_slice(&color);
            }
        }
    }

    let writer = BufWriter::new(File::create(icon_dir.join("icon.png")).unwrap());
    let mut encoder = png::Encoder::new(writer, SIZE, SIZE);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut png_writer = encoder.write_header().unwrap();
    png_writer.write_image_data(&pixels).unwrap();
}

/// The checkout the app runs its server from. A path set by whoever builds the
/// app wins, under its current name or the one it had before the codeStory
/// rename; otherwise it is the checkout this crate lives in.
fn project_path(manifest: &Path) -> PathBuf {
    const NAMES: [&str; 2] = ["CODESTORY_PROJECT_PATH", "DIFFSTORY_PROJECT_PATH"];
    for name in NAMES {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let checkout = manifest.parent().and_then(Path::parent).unwrap();
    NAMES
        .into_iter()
        .find_map(std::env::var_os)
        .map_or_else(|| checkout.to_path_buf(), PathBuf::from)
}

fn main() {
    generate_icon();
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    println!(
        "cargo:rustc-env=CODESTORY_PROJECT_PATH={}",
        project_path(&manifest).display()
    );
    tauri_build::build();
}
