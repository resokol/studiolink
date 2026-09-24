cmake_minimum_required(VERSION 3.20)
project(StudioLinkStudioWindows LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT WIN32)
  message(FATAL_ERROR "StudioLink Studio Windows must be built on Windows with MSVC.")
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(LiveKitSDK)
livekit_sdk_setup(
  VERSION "1.12.0"
  SDK_DIR "${CMAKE_BINARY_DIR}/_deps/livekit-sdk"
  GITHUB_TOKEN "$ENV{GITHUB_TOKEN}"
)
find_package(LiveKit CONFIG REQUIRED)

if(TARGET LiveKit::livekit)
  set(LIVEKIT_CORE_TARGET LiveKit::livekit)
elseif(TARGET livekit)
  set(LIVEKIT_CORE_TARGET livekit)
else()
  message(FATAL_ERROR "Could not find LiveKit core target.")
endif()

add_executable(StudioLinkStudio WIN32 src/main.cpp)
target_compile_definitions(StudioLinkStudio PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(StudioLinkStudio PRIVATE ${LIVEKIT_CORE_TARGET} ole32 winhttp)

get_filename_component(_lk_cmake_parent "${LiveKit_DIR}" DIRECTORY)
get_filename_component(_lk_lib_dir "${_lk_cmake_parent}" DIRECTORY)
get_filename_component(_lk_prefix "${_lk_lib_dir}" DIRECTORY)
set(_lk_bin_dir "${_lk_prefix}/bin")
foreach(_dll IN ITEMS livekit.dll livekit_ffi.dll)
  if(EXISTS "${_lk_bin_dir}/${_dll}")
    add_custom_command(TARGET StudioLinkStudio POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${_lk_bin_dir}/${_dll}" "$<TARGET_FILE_DIR:StudioLinkStudio>")
  endif()
endforeach()
