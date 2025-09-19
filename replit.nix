{ pkgs }: {
  deps = [
    # Core development dependencies
    pkgs.nodejs_20
    pkgs.postgresql_16
    pkgs.python311
    pkgs.python311Packages.pip
    pkgs.python311Packages.venv
    
    # ITK and build dependencies
    pkgs.cmake
    pkgs.gcc
    pkgs.pkg-config
    pkgs.libuuid
    pkgs.unzip
    pkgs.jq
    
    # ITK library and development headers
    pkgs.itk
    pkgs.hdf5
    pkgs.hdf5-cpp
    
    # Additional system libraries that ITK might need
    pkgs.zlib
    pkgs.libpng
    pkgs.libjpeg
    pkgs.libtiff
    pkgs.eigen
  ];
  
  env = {
    # Set up ITK paths for compilation
    ITK_DIR = "${pkgs.itk}/lib/cmake/ITK-5.3";
    CMAKE_PREFIX_PATH = "${pkgs.itk}:${pkgs.hdf5}";
    PKG_CONFIG_PATH = "${pkgs.itk}/lib/pkgconfig:${pkgs.hdf5}/lib/pkgconfig";
    
    # Python environment
    PYTHON_PATH = "${pkgs.python311}/bin/python3";
    
    # Replit-specific paths (will be set at runtime)
    REPLIT_WORKSPACE = "/home/runner/CONVERGE_REPLIT_VIEWER";
  };
}
