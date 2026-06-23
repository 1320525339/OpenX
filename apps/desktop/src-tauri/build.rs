use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();
    copy_sidecar_node_modules();
}

/// pkg sidecar 需要在 exe 同目录找到 node_modules/better-sqlite3 与 pi-child-runner.cjs
fn copy_sidecar_node_modules() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let profile = env::var("PROFILE").expect("PROFILE");
    let target_dir = manifest_dir.join("target").join(&profile);
    let src_modules = manifest_dir.join("binaries").join("node_modules");
    let src_pi_child = manifest_dir.join("binaries").join("pi-child-runner.cjs");

    println!("cargo:rerun-if-changed=binaries/node_modules");
    println!("cargo:rerun-if-changed=binaries/pi-child-runner.cjs");

    if !src_modules.exists() {
        println!(
            "cargo:warning=Sidecar node_modules missing at {}; run pnpm build:server first",
            src_modules.display()
        );
        return;
    }

    let dst_modules = target_dir.join("node_modules");
    if dst_modules.exists() {
        let _ = fs::remove_dir_all(&dst_modules);
    }

    if let Err(err) = copy_dir_all(&src_modules, &dst_modules) {
        println!(
            "cargo:warning=Failed to copy sidecar node_modules to {}: {err}",
            dst_modules.display()
        );
    } else {
        println!(
            "cargo:warning=Copied sidecar node_modules to {}",
            dst_modules.display()
        );
    }

    if src_pi_child.exists() {
        let dst_pi_child = target_dir.join("pi-child-runner.cjs");
        if let Err(err) = fs::copy(&src_pi_child, &dst_pi_child) {
            println!(
                "cargo:warning=Failed to copy pi-child-runner.cjs to {}: {err}",
                dst_pi_child.display()
            );
        } else {
            println!(
                "cargo:warning=Copied pi-child-runner.cjs to {}",
                dst_pi_child.display()
            );
        }
    } else {
        println!(
            "cargo:warning=pi-child-runner.cjs missing at {}; run pnpm build:server first",
            src_pi_child.display()
        );
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
