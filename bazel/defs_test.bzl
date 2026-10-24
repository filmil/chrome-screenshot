# SPDX-License-Identifier: Apache-2.0
"""Tests of version_error, which decides what versions the build takes."""

load("@bazel_skylib//lib:unittest.bzl", "asserts", "unittest")
load(":defs.bzl", "version_error")

def _version_error_test_impl(ctx):
    env = unittest.begin(ctx)
    for good in ["0", "1", "0.1.0", "2026.10.23", "2026.10.23.1", "65535.0.65535.0"]:
        asserts.equals(env, None, version_error(good), good)
    for bad in ["", "1.", ".1", "1..2", "1.2.3.4.5", "65536", "1.02", "00",
                "-1", "1.a", "1 .2", "1e3"]:
        asserts.true(env, version_error(bad) != None, "took %r" % bad)
    return unittest.end(env)

_version_error_test = unittest.make(_version_error_test_impl)

def version_test_suite(name):
    unittest.suite(name, _version_error_test)
