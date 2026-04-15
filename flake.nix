{
  description = "Chatbot proof-of-concept — Next.js frontend + FastAPI backend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # uv2nix stack
    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, uv2nix, pyproject-nix, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # ------------------------------------------------------------------ #
        # Python / FastAPI env via uv2nix
        # ------------------------------------------------------------------ #
        # Once you have a pyproject.toml + uv.lock, swap the devShell below
        # for a proper uv2nix virtualenv overlay.  Until then this gives you
        # uv so you can `uv init` and `uv add fastapi uvicorn`.
        pythonDevInputs = with pkgs; [
          python313
          uv
        ];

        # ------------------------------------------------------------------ #
        # Node / Next.js env
        # ------------------------------------------------------------------ #
        # Use this shell to `npx create-next-app` and `npx shadcn@latest init`.
        # After you have a package-lock.json we can wire up buildNpmPackage or
        # node2nix for a hermetic build.
        nodeDevInputs = with pkgs; [
          nodejs_24
        ];

      in
      {
        # ------------------------------------------------------------------ #
        # Dev shells
        # ------------------------------------------------------------------ #
        devShells = {
          # `nix develop` — everything in one shell
          default = pkgs.mkShell {
            name = "hen-wen";
            packages = nodeDevInputs ++ pythonDevInputs ++ (with pkgs; [
              git
            ]);
            shellHook = ''
              echo "hen-wen dev shell"
              echo "  node $(node --version)  |  npm $(npm --version)"
              echo "  python $(python3 --version)  |  uv $(uv --version)"
            '';
          };

          # `nix develop .#frontend` — Node only
          frontend = pkgs.mkShell {
            name = "hen-wen-frontend";
            packages = nodeDevInputs;
          };

          # `nix develop .#backend` — Python only
          backend = pkgs.mkShell {
            name = "hen-wen-backend";
            packages = pythonDevInputs;
          };
        };
      }
    );
}
