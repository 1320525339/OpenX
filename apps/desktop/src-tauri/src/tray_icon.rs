use image::{Rgba, RgbaImage};
use std::sync::OnceLock;
use tauri::image::Image;

fn draw_dot(img: &mut RgbaImage, cx: i32, cy: i32, radius: i32, color: Rgba<u8>) {
    let (w, h) = img.dimensions();
    for y in (cy - radius).max(0)..(cy + radius).min(h as i32) {
        for x in (cx - radius).max(0)..(cx + radius).min(w as i32) {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= radius * radius {
                img.put_pixel(x as u32, y as u32, color);
            }
        }
    }
}

fn decode_icon(bytes: &[u8]) -> RgbaImage {
    image::load_from_memory(bytes)
        .expect("tray icon decode")
        .to_rgba8()
}

fn encode_icon(img: &RgbaImage) -> Image<'static> {
    let (w, h) = img.dimensions();
    let bytes: &'static [u8] = Box::leak(img.as_raw().clone().into_boxed_slice());
    Image::new(bytes, w, h)
}

pub fn tray_icon_idle() -> Image<'static> {
    static ICON: OnceLock<Image<'static>> = OnceLock::new();
    ICON.get_or_init(|| Image::from_bytes(include_bytes!("../icons/icon.png")).expect("idle icon"))
        .clone()
}

pub fn tray_icon_busy() -> Image<'static> {
    static ICON: OnceLock<Image<'static>> = OnceLock::new();
    ICON.get_or_init(|| {
        let mut img = decode_icon(include_bytes!("../icons/icon.png"));
        let (w, h) = img.dimensions();
        draw_dot(
            &mut img,
            w as i32 - 10,
            h as i32 - 10,
            6,
            Rgba([34, 197, 94, 255]),
        );
        encode_icon(&img)
    })
    .clone()
}

pub fn tray_icon_booting() -> Image<'static> {
    static ICON: OnceLock<Image<'static>> = OnceLock::new();
    ICON.get_or_init(|| {
        let mut img = decode_icon(include_bytes!("../icons/icon.png"));
        let (w, h) = img.dimensions();
        draw_dot(
            &mut img,
            w as i32 - 10,
            h as i32 - 10,
            6,
            Rgba([250, 204, 21, 255]),
        );
        encode_icon(&img)
    })
    .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_busy_and_booting_icons() {
        let _ = tray_icon_busy();
        let _ = tray_icon_booting();
    }
}
