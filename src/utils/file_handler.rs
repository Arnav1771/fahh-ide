use std::fs;
use std::io;
use std::path::Path;

pub fn read_file(path: &str) -> Result<String, io::Error> {
    fs::read_to_string(path)
}

pub fn write_file(path: &str, content: &str) -> Result<(), io::Error> {
    fs::write(path, content)
}

pub fn create_dir(path: &str) -> Result<(), io::Error> {
    fs::create_dir_all(path)
}

pub fn delete_file(path: &str) -> Result<(), io::Error> {
    fs::remove_file(path)
}

pub fn delete_dir(path: &str) -> Result<(), io::Error> {
    fs::remove_dir_all(path)
}

pub fn file_exists(path: &str) -> bool {
    Path::new(path).exists()
}

pub fn dir_exists(path: &str) -> bool {
    Path::new(path).is_dir()
}

pub fn get_file_size(path: &str) -> Result<u64, io::Error> {
    fs::metadata(path).map(|metadata| metadata.len())
}

pub fn get_dir_size(path: &str) -> Result<u64, io::Error> {
    let mut total_size = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            total_size += fs::metadata(&path)?.len();
        } else if path.is_dir() {
            total_size += get_dir_size(path.to_str().unwrap())?;
        }
    }
    Ok(total_size)
}