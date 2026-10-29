// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = focus_diff_lib::link::command_line(&args) {
        std::process::exit(code);
    }
    focus_diff_lib::run()
}
