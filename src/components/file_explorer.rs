use leptos::*;
use leptos_meta::*;
use leptos_router::*;

pub struct FileExplorer {
    pub files: Vec<File>,
}

#[derive(Props)]
pub struct FileProps {
    pub file: File,
}

#[derive(Clone, Debug, PartialEq)]
pub struct File {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<File>,
}

impl File {
    pub fn new(name: String, path: String, is_dir: bool) -> Self {
        Self {
            name,
            path,
            is_dir,
            children: vec![],
        }
    }
}

impl Component for FileExplorer {
    type Message = ();
    type Properties = ();

    fn create(_: Self::Properties, _: ComponentLink<Self>) -> Self {
        let files = vec![
            File::new("File 1".to_string(), "/file1".to_string(), false),
            File::new("Folder 1".to_string(), "/folder1".to_string(), true),
            File::new("File 2".to_string(), "/file2".to_string(), false),
        ];

        Self { files }
    }

    fn update(&mut self, _: Self::Message) {}

    fn view(&self) -> Html {
        view! {
            <div class="file-explorer">
                <h1 class="file-explorer-header">File Explorer</h1>
                <ul class="file-explorer-list">
                    {self.files.iter().map(|file| view! {
                        <File file={file.clone()} />
                    }).collect::<Html>()}
                </ul>
            </div>
        }
    }
}

impl Component for File {
    type Message = ();
    type Properties = FileProps;

    fn create(props: Self::Properties, _: ComponentLink<Self>) -> Self {
        Self { file: props.file }
    }

    fn update(&mut self, _: Self::Message) {}

    fn view(&self) -> Html {
        view! {
            <li class="file-explorer-item">
                <span class="file-explorer-item-name">{self.file.name.clone()}</span>
                {if self.file.is_dir {
                    view! {
                        <ul class="file-explorer-list">
                            {self.file.children.iter().map(|file| view! {
                                <File file={file.clone()} />
                            }).collect::<Html>()}
                        </ul>
                    }
                } else {
                    view! {}
                }}
            </li>
        }
    }
}

#[cfg(target_arch = "wasm32")]
leptos::main!(|_| {
    view! {
        <FileExplorer />
    }
});

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    leptos::web::start(|_| {
        view! {
            <FileExplorer />
        }
    });
}

#[cfg(not(target_arch = "wasm32"))]
mod server {
    use actix_web::{web, App, HttpResponse, HttpServer, Responder};
    use std::env;

    async fn index() -> impl Responder {
        HttpResponse::Ok().body(include_str!("index.html"))
    }

    #[actix_web::main]
    async fn main() -> std::io::Result<()> {
        let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
        HttpServer::new(|| {
            App::new()
                .route("/", web::get().to(index))
        })
        .bind(format!("127.0.0.1:{}", port))?
        .run()
        .await
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod static_files {
    use actix_files::NamedFile;
    use actix_web::{web, App, HttpResponse, HttpServer, Responder};
    use std::env;

    async fn index() -> impl Responder {
        HttpResponse::Ok().body(include_str!("index.html"))
    }

    async fn static_file(path: web::Path<String>) -> impl Responder {
        let file_path = format!("./static/{}", path);
        match NamedFile::open(file_path) {
            Ok(file) => file,
            Err(_) => HttpResponse::NotFound().body("File not found"),
        }
    }

    #[actix_web::main]
    async fn main() -> std::io::Result<()> {
        let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
        HttpServer::new(|| {
            App::new()
                .route("/", web::get().to(index))
                .route("/static/{path:.*}", web::get().to(static_file))
        })
        .bind(format!("127.0.0.1:{}", port))?
        .run()
        .await
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod tauri {
    use tauri::{Builder, Window};

    fn main() {
        Builder::default()
            .invoke_handler(tauri::generate_handler![])
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod docker {
    use std::env;

    fn main() {
        let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
        println!("Server listening on port {}", port);
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod vercel {
    use std::env;

    fn main() {
        let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
        println!("Server listening on port {}", port);
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod logging {
    use log::info;
    use std::env;

    fn main() {
        env_logger::init();
        info!("Server started");
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod secrets {
    use std::env;

    fn main() {
        let secret = env::var("SECRET").unwrap_or_else(|_| "default_secret".to_string());
        println!("Secret: {}", secret);
    }
}