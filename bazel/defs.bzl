# SPDX-License-Identifier: Apache-2.0
"""The extension's manifest with its release version, and Node tests."""

load("@bazel_skylib//rules:common_settings.bzl", "BuildSettingInfo")
load("@rules_pkg//pkg:providers.bzl", "PackageVariablesInfo")

_NODE = "@rules_nodejs//nodejs:toolchain_type"
_NODE_RUNTIME = "@rules_nodejs//nodejs:runtime_toolchain_type"

def version_error(version):
    """Why Chrome would refuse `version`, or None if it would take it.

    Chrome takes 1 to 4 dot-separated integers, each 0 to 65535, with no
    leading zeros.
    """
    parts = version.split(".")
    if len(parts) > 4:
        return "more than 4 parts"
    for p in parts:
        if not p.isdigit():
            return "%r is not a number" % p
        if len(p) > 1 and p.startswith("0"):
            return "%r has a leading zero" % p
        if int(p) > 65535:
            return "%r is over 65535" % p
    return None

def check_version(version):
    """Fails unless Chrome would take `version`."""
    error = version_error(version)
    if error:
        fail("bad extension version %r: %s" % (version, error))

def _version(ctx):
    version = ctx.attr._version[BuildSettingInfo].value
    check_version(version)
    return version

def _manifest_impl(ctx):
    version = _version(ctx)
    out = ctx.actions.declare_file(ctx.label.name + "/manifest.json")
    node = ctx.toolchains[_NODE].nodeinfo.node
    ctx.actions.run(
        executable = node,
        arguments = [ctx.file._script.path, ctx.file.src.path, out.path, version],
        inputs = [ctx.file.src, ctx.file._script],
        outputs = [out],
        mnemonic = "ExtensionManifest",
        progress_message = "Setting the extension version to " + version,
    )
    return [DefaultInfo(files = depset([out]))]

extension_manifest = rule(
    implementation = _manifest_impl,
    doc = "The manifest `src`, with its version set from //:version.",
    attrs = {
        "src": attr.label(allow_single_file = [".json"], mandatory = True),
        "_script": attr.label(default = "//bazel:set_version.mjs", allow_single_file = True),
        "_version": attr.label(default = "//:version"),
    },
    toolchains = [_NODE],
)

def _variables_impl(ctx):
    return [PackageVariablesInfo(values = {"version": _version(ctx)})]

package_variables = rule(
    implementation = _variables_impl,
    doc = "The release version, for the zip's file name.",
    attrs = {"_version": attr.label(default = "//:version")},
)

def _node_test_impl(ctx):
    node = ctx.toolchains[_NODE_RUNTIME].nodeinfo.node
    script = ctx.actions.declare_file(ctx.label.name + ".sh")
    ctx.actions.write(
        output = script,
        is_executable = True,
        content = "#!/bin/sh\nexec {node} --test {tests}\n".format(
            node = node.short_path,
            tests = " ".join([f.short_path for f in ctx.files.srcs]),
        ),
    )
    runfiles = ctx.runfiles(files = [node] + ctx.files.srcs + ctx.files.data)
    return [DefaultInfo(executable = script, runfiles = runfiles)]

node_test = rule(
    implementation = _node_test_impl,
    doc = "Runs `node --test` on `srcs`, with `data` beside them.",
    test = True,
    attrs = {
        "srcs": attr.label_list(allow_files = [".mjs", ".js"], mandatory = True),
        "data": attr.label_list(allow_files = True),
    },
    toolchains = [_NODE_RUNTIME],
)
