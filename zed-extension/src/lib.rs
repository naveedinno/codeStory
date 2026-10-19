use std::{env, path::Path};
use zed_extension_api::{self as zed, Command, ContextServerId, Project};

const CONTEXT_SERVER_ID: &str = "codestory";
const SERVER_PATH: &str = "server/codestory-mcp.mjs";

struct CodeStoryExtension;

impl zed::Extension for CodeStoryExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Command, String> {
        if context_server_id.as_ref() != CONTEXT_SERVER_ID {
            return Err(format!(
                "unknown codeStory context server: {}",
                context_server_id.as_ref()
            ));
        }
        let extension_root = env::current_dir().map_err(|error| error.to_string())?;
        Ok(Command {
            command: zed::node_binary_path()?,
            args: server_args(&extension_root),
            env: Default::default(),
        })
    }
}

fn server_args(extension_root: &Path) -> Vec<String> {
    vec![extension_root
        .join(SERVER_PATH)
        .to_string_lossy()
        .into_owned()]
}

zed::register_extension!(CodeStoryExtension);

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn context_server_uses_the_bundled_node_entrypoint() {
        assert_eq!(
            server_args(Path::new("/tmp/codestory-zed")),
            vec![PathBuf::from("/tmp/codestory-zed/server/codestory-mcp.mjs")
                .to_string_lossy()
                .into_owned()]
        );
    }
}
