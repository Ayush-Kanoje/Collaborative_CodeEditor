#!/bin/bash
# Manual testing script for environment-driven configuration
# Run different test scenarios to verify behavior changes

echo "==================================================="
echo "Environment-Driven Configuration Manual Tests"
echo "==================================================="
echo ""

echo "Test 1: Default configuration"
echo "Command: npm start"
echo "Expected: Server on port 3000, CORS http://localhost:5173"
echo "Press Ctrl+C to stop, then run next test"
echo ""
npm start

echo ""
echo "Test 2: Custom PORT"
echo "Command: PORT=4000 npm start"
echo "Expected: Server on port 4000"
echo ""
PORT=4000 npm start

echo ""
echo "Test 3: Custom CORS_ORIGIN"
echo "Command: CORS_ORIGIN=https://example.com npm start"
echo "Expected: Only allows https://example.com"
echo ""
CORS_ORIGIN=https://example.com npm start

echo ""
echo "Test 4: Multiple CORS origins"
echo "Command: CORS_ORIGINS='http://localhost:3000,http://localhost:5173' npm start"
echo "Expected: Allows both origins"
echo ""
CORS_ORIGINS="http://localhost:3000,http://localhost:5173" npm start

echo ""
echo "Test 5: Production environment"
echo "Command: NODE_ENV=production PORT=8080 CORS_ORIGIN=https://prod.example.com npm start"
echo ""
NODE_ENV=production PORT=8080 CORS_ORIGIN=https://prod.example.com npm start
