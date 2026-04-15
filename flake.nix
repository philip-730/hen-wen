{
  description = "Chatbot proof-of-concept — Next.js frontend + FastAPI backend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, uv2nix, pyproject-nix, pyproject-build-systems, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        inherit (nixpkgs) lib;
        pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };

        # ------------------------------------------------------------------ #
        # Backend — Python venv via uv2nix
        # ------------------------------------------------------------------ #
        workspace = uv2nix.lib.workspace.loadWorkspace {
          workspaceRoot = ./backend;
        };

        overlay = workspace.mkPyprojectOverlay {
          sourcePreference = "wheel";
        };

        pythonSet = (pkgs.callPackage pyproject-nix.build.packages {
          python = pkgs.python313;
        }).overrideScope (lib.composeManyExtensions [
          pyproject-build-systems.overlays.default
          overlay
        ]);

        backendVenv = pythonSet.mkVirtualEnv "hen-wen-backend-env"
          workspace.deps.default;

        # main.py lives outside the venv — include it as a separate derivation
        backendSrc = pkgs.runCommand "hen-wen-backend-src" { } ''
          mkdir -p $out/app
          cp ${./backend/main.py} $out/app/main.py
        '';

        # ------------------------------------------------------------------ #
        # Frontend — Next.js standalone build via buildNpmPackage
        # ------------------------------------------------------------------ #
        frontend = pkgs.buildNpmPackage {
          name = "hen-wen-frontend";
          src = ./frontend;

          # Run `nix build .#frontend-image` with this as lib.fakeHash,
          # then replace with the hash from the error message.
          npmDepsHash = "sha256-3ZRm+M/gprLcbRhlOpKXv0RsfxoR/M7N5tNOQFpvrhg=";
          # npmDepsHash =  pkgs.lib.fakeHash;

          NEXT_TELEMETRY_DISABLED = "1";

          preBuild = ''
            export NODE_ENV=production
          '';

          installPhase = ''
            runHook preInstall
            cp -r .next/standalone/. $out/
            mkdir -p $out/.next
            cp -r .next/static $out/.next/static
            cp -r public $out/public
            runHook postInstall
          '';
        };

        # ------------------------------------------------------------------ #
        # OCI images via dockerTools
        # ------------------------------------------------------------------ #
        backendImage = pkgs.dockerTools.streamLayeredImage {
          name = "hen-wen-backend";
          tag = "latest";
          contents = [ pkgs.cacert backendVenv backendSrc ];
          config = {
            Cmd = [
              "${backendVenv}/bin/uvicorn"
              "main:app"
              "--host" "0.0.0.0"
              "--port" "8080"
              "--proxy-headers"
            ];
            WorkingDir = "${backendSrc}/app";
            Env = [
              "PYTHONPATH=${backendSrc}/app"
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            ];
            ExposedPorts = { "8080/tcp" = { }; };
          };
        };

        frontendImage = pkgs.dockerTools.streamLayeredImage {
          name = "hen-wen-frontend";
          tag = "latest";
          contents = [ pkgs.cacert pkgs.nodejs_24 frontend ];
          config = {
            Cmd = [ "${pkgs.nodejs_24}/bin/node" "${frontend}/server.js" ];
            WorkingDir = "${frontend}";
            Env = [
              "NODE_EXTRA_CA_CERTS=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            ];
            ExposedPorts = { "3000/tcp" = { }; };
          };
        };

        # ------------------------------------------------------------------ #
        # Dev inputs
        # ------------------------------------------------------------------ #
        pythonDevInputs = with pkgs; [ python313 uv ];
        nodeDevInputs   = with pkgs; [ nodejs_24 ];
        infraDevInputs  = with pkgs; [ terraform just skopeo ];

      in
      {
        # OCI images — built with `nix build .#backend-image` etc.
        packages = {
          backend-image  = backendImage;
          frontend-image = frontendImage;
        };

        devShells = {
          default = pkgs.mkShell {
            name = "hen-wen";
            packages = nodeDevInputs ++ pythonDevInputs ++ infraDevInputs ++ [ pkgs.git ];
            shellHook = ''
              echo "hen-wen dev shell"
              echo "  node $(node --version)  |  npm $(npm --version)"
              echo "  python $(python3 --version)  |  uv $(uv --version)"
            '';
          };

          frontend = pkgs.mkShell {
            name = "hen-wen-frontend";
            packages = nodeDevInputs;
          };

          backend = pkgs.mkShell {
            name = "hen-wen-backend";
            packages = pythonDevInputs;
          };
        };
      }
    );
}
