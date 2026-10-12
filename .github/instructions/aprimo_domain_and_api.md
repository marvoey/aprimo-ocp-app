# Aprimo DAM Integration Overview

Aprimo DAM provides a REST API for accessing assets (records) and related metadata. Assets have content types (e.g. Image, Video, Document) and each asset is represented by a Record resource. We will use OAuth2 bearer tokens for service-to-service auth and call endpoints to list and read asset metadata. Webhook notifications are implemented via Rules that trigger HTTP calls on record changes.

## TODOs

- test all the below APIs
- which source objects to expose from the app - Aprimo supports creating custom content types. Although, there exist build in content types, customers can crate their own types to host some images for example. Aprimo team suggested to filter by extension, however, the issue with is that there might be no common schema for all content types hosting files with the same extensions
- how to get URLs - Aprimo team suggested to use public links feature

## Authorization

Aprimo uses OAuth 2.0 with a **registered client** (see https://developers.aprimo.com/docs/OAuth2). All flows use a single token endpoint on the Marketing Ops host (not the DAM subdomain):

`POST https://{tenant}.aprimo.com/login/connect/token` (`Content-Type: application/x-www-form-urlencoded`)

| Flow | Use case | User interaction |
| ---- | -------- | ---------------- |
| Client Credentials | Service-to-service, runs as one registered user. **Used by this app.** | No |
| Resource Owner Password | Uses a user's Aprimo user token as the `password`; no refresh token | No |
| Authorization Code + PKCE | Individual users log in via browser; supports refresh tokens | Yes |

> The previously documented `/api/oauth/create-native-token` endpoint does not exist (returns 404). Do not use it.

### Register the client in Aprimo

Requires the Security or System Administration domain right.

1. Go to **Administration > Integration > Registrations** and click **New**.
2. Set **OAuth Flow Type** to **Client Credentials**.
3. Enter a name, description and a client secret (you choose it; it cannot be retrieved later, so store it securely).
4. Set the **User** the client runs as (a dedicated integration user with read access to records) and an access token lifetime (1-60 minutes).
5. Leave the redirect URL empty (needed for PKCE only) and save. Changes can take up to 15 minutes to apply.

### Get a token

```bash
curl -X POST "https://yourdomain.aprimo.com/login/connect/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials&scope=api&client_id={client_id}&client_secret={client_secret}"
```

The response contains `access_token`, `expires_in` (seconds) and `token_type: Bearer`. No refresh token is issued for client credentials; request a new token when it expires or an API call returns 401. Scope `api` covers the REST API and DAM downloads.

Store the client secret in the app's settings (secret field) and the token in the secret store. Never log either.

Use the access token in subsequent DAM API calls:

##  Test API call with Bearer token
```
curl -H "Authorization: Bearer {access_token}" -H "API-Version: 1" \
     https://yourdomain.dam.aprimo.com/api/core/records
```

If credentials are valid, you should get an (empty or populated) JSON list of records.

Store the token in secret store and refresh when needed. 

## Schema (Image/Video)

### Custom vs Built‑In Content Types
Content types are fully configurable—customers can create, rename, or remove custom content types beyond the built-in ones. Aprimo does provide built-in system content types such as Image, Video, plus others like Document and Article, but customers may extend or define their own types via the ContentType API. Editing names or removing types may be restricted if records exist for that type, but new types are supported via the API or platform settings 

Every content type uses the general Record schema with standard shared properties. These include:
| Field         | Description                                |
| ------------- | ------------------------------------------ |
| `id`          | Unique identifier for the record           |
| `contentType` | The content type (e.g. “Image”)            |
| `createdOn`   | Timestamp when created                     |
| `modifiedOn`  | Timestamp of last modification             |
| `status`      | Status (e.g. Released, Draft)              |
| `title`       | Record title                               |
| `tag`         | (Optional) tag XML content                 |
| `textContent` | (Optional) textual metadata field          |
| `_links`      | HAL navigation links (files, fields, etc.) |

These fields are part of every Record regardless of content type.

### Image & Video Content Type Fields

Dozens of metadata fields may be attached via custom registered fields.

#### Built‑in Image Content Type

Built-in defaults include:
- defaultFileExtensions (e.g. JPG, PNG, TIFF)
- fileMode
- titleConfiguration
- registeredFields (IDs of custom fields specific to that content type)
- Standard Record fields apply (id, createdOn, etc.) 

#### Built‑in Video Content Type

Includes:
- defaultFileExtensions (e.g. MP4, AVI)
- fileMode
- registeredFields
- titleConfiguration
- labels / localized label values

Together with shared Record fields, and any configured custom metadata fields attached to the content type definition

### Custom Metadata Fields per Content Type

Each content type (e.g. Image or Video) may have its own registeredFields list—these represent custom metadata defined for that type in your Aprimo tenant. To inspect them:

```bash
curl -H "Authorization: Bearer {token}" -H "API-Version: 1" \
  https://yourdomain.dam.aprimo.com/api/core/contenttype?name=Image

curl -H "Authorization: Bearer {token}" -H "API-Version: 1" \
  https://yourdomain.dam.aprimo.com/api/core/contenttype?name=Video
```

The response includes the registeredFields IDs. You can query each via `/field/{fieldId}` or `/fields` API to get its schema: name, type, defaultValue, rules, etc.

### Public URL for Asset Renditions

Aprimo supports public links (CDN URLs) for asset renditions. To retrieve them:
- Request the asset via GET /record/{id}.
- Include select headers to fetch file versions, renditions, and public links:
```
curl -H "Authorization: Bearer {token}" \
     -H "API-Version: 1" \
     -H "select-record: title,thumbnail,fields,masterfileversion" \
     -H "select-fileversion: renditions" \
     -H "select-rendition: publiclinks" \
  https://yourtenant.dam.aprimo.com/api/core/record/{assetId}
```

This returns, under the record JSON:
- `masterfileversion.renditions`: list of rendition objects

Each rendition has a `publiclinks` array with a href value—the public CDN URL for that rendition (image, video, preview, etc.)

### Image Dimensions via Crops

For images, Aprimo supports crops (e.g. thumbnails or predefined aspect ratios). Via the API:
- Access Crops API (/record/{id}/crops) to list crops.
- Crop objects include metadata such as width, height, and publicuri (URL).

Example request:
```bash
curl -H "Authorization: Bearer {token}" \
     -H "API-Version: 1" \
  https://yourtenant.dam.aprimo.com/api/core/record/{assetId}/crops
```

Each crop entry includes:
- id
- width, height
- publicLinks or publicuri for access via CDN

### Retrieving records (assets) with rendations and dimentions

You can also request records with renditions and dimensions, for example via /renditions endpoint after select-fileversion, depending on configuration.

This is outlined in the [Crops, Trims, and Renditions documentation](https://developers.aprimo.com/docs/rest-api/dam/crops-trims-renditions).

Get Asset Metadata (including file versions and renditions):

```bash
curl -H "Authorization: Bearer {token}" \
     -H "API-Version: 1" \
     -H "select-record: fields,masterfileversion" \
     -H "select-fileversion: renditions" \
     -H "select-rendition: publiclinks" \
  https://yourtenant.dam.aprimo.com/api/core/record/{assetId}
```

Example results: 
```
{
  "id": "271ee18a-d088-4ece-bfc3-a3cd0069d759",
  "title": "Hero Banner",
  "contentType": "Image",
  "masterFileVersion": {
    "renditions": [
      {
        "name": "thumbnail",
        "width": 300,
        "height": 200,
        "publicLinks": [
          {
            "href": "https://cdn.your-aprimo-instance.com/thumbnails/hero-banner.jpg"
          }
        ]
      },
      {
        "name": "original",
        "publicLinks": [
          {
            "href": "https://cdn.your-aprimo-instance.com/originals/hero-banner.jpg"
          }
        ]
      }
    ]
  }
}
```

In Aprimo, rendition names like `thumbnail` and `original` are not arbitrary, but also not fully hardcoded.

Aprimo DAM comes with a set of default system renditions, including:
- "thumbnail" – often a small-sized preview (e.g. 300x200)
- "original" – typically the full-resolution file
- "preview" – an intermediate-size image, used in UIs
- "poster" – commonly used for videos (still image)

These are automatically generated based on the asset type and the settings defined in the Media Engine configuration of your tenant.

Admins can define custom rendition profiles (e.g., "hero-1920", "web-optimized") via Aprimo’s DAM configuration. These custom renditions:
- Have unique names defined by your org
- Appear alongside built-in ones in renditions[]
- Can be generated automatically or manually

| Rendition Name   | Predefined by Aprimo? | Can be Customized? | Common Use                       |
| ---------------- | --------------------- | ------------------ | -------------------------------- |
| `thumbnail`      | ✅ Yes                 | ⚠️ Name is fixed   | Small previews (e.g., list view) |
| `original`       | ✅ Yes                 | ⚠️ Name is fixed   | Full-resolution source file      |
| `preview`        | ✅ Yes                 | ⚠️ Name is fixed   | Medium previews                  |
| `poster`         | ✅ Yes (for video)     | ⚠️ Name is fixed   | Video preview frame              |
| `web-hero`, etc. | ❌ No                  | ✅ Yes              | Custom web renditions            |

If your integration depends on consistent names, you can safely use "thumbnail", "original", and "preview" across assets—these are present on all image/video files processed through Aprimo's media pipeline.

## Fetch All Assets by Type

To fetch all assets of a given type (e.g. all Images or all Videos), query the records collection with a filter on content type. For example, to list all Video assets:
```bash
curl -G -H "Authorization: Bearer {access_token}" -H "API-Version: 1" \
     --data-urlencode 'filter=ContentType = "Video"' \
     https://yourdomain.dam.aprimo.com/api/core/records
```

This will return a paged JSON RecordPagedCollection of records where contentType is “Video”. Similarly for images, use ContentType = "Image". (The exact string depends on your configuration; by default, images may have contentType “Record” or a named type.) You can page through results using `?page=` and `?pageSize=` parameters or the HAL _links. Each returned record object will include basic fields (id, createdOn, etc.) and links to sub-resources. To include metadata fields and file info in one call, use select-record headers. For example, to embed files in the result:

```bash
curl -G -H "Authorization: Bearer {token}" -H "API-Version: 1" \
     -H "accept: application/hal+json" \
     -H "select-record: classifications,files" \
     --data-urlencode 'filter=ContentType = "Video"' \
     https://yourdomain.dam.aprimo.com/api/core/records
```

This will return each record’s classifications and files embedded in the JSON.

## Register Webhook (Rule)
Aprimo uses Rules for event-driven webhooks. You register a rule via the API so that on record create/update/delete, Aprimo will HTTP-POST to your integration endpoint. To create a rule, POST to /rules with target “Record” and trigger “WhenSavedOrDeleted”. At minimum, include one condition (e.g. ObjectCreatedOrChanged) and one action of type Reference pointing to your webhook URL. 

For example:
```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer {token}" -H "API-Version: 1" \
  https://yourdomain.dam.aprimo.com/api/core/rules \
  -d '{
    "name": "NotifyOptimizelyOnAssetChange",
    "enabled": "true",
    "target": "Record",
    "trigger": "WhenSavedOrDeleted",
    "conditions": {
      "addOrUpdate": [
        { "ConditionType": "ObjectCreatedOrChanged" }
      ]
    },
    "actions": {
      "addOrUpdate": [
        {
          "ActionType": "Reference",
          "Reference": "<ref:httpRequest uri=\"https://my-optimizely-endpoint/webhook\" />",
          "ExecutionTime": "Immediately"
        }
      ]
    }
  }'
```

This creates a rule named `NotifyOptimizelyOnAssetChange` that fires for any record saved or deleted. The `<ref:httpRequest>` tells Aprimo to POST to your given URI. (You can add query parameters or payload templates as needed per Aprimo’s rule syntax.) See the Rules resource docs for details: the example `Creating a rule` shows target: `Record`, trigger: `WhenSavedOrDeleted` and an action with `<ref:httpRequest>`.

## Handling Webhook Events

When Aprimo fires the rule, it will make an HTTP request to your endpoint. (By default this is likely a GET or POST with no body, but you could configure it to send data via `<ref:httpRequest>` parameters.) In practice, you’ll usually need to fetch the full asset details by calling Aprimo API. The webhook should at least convey the Record ID and event type. Often the rule can be set to call `<yourURL>?id={RecordId}`. Your webhook endpoint should then call Aprimo’s `GET /record/{id}` to retrieve the latest data. For example:

```bash
curl -H "Authorization: Bearer {access_token}" -H "API-Version: 1" \
     https://yourdomain.dam.aprimo.com/api/core/record/271ee18ad0884ecebfc3a3cd0069d759
```

The returned JSON will include the record’s schema (see Resource: Record). Key fields include: contentType (“Video” or other) and standard fields like id, createdOn, modifiedOn, status, title, tag and any custom fields. For example: 

```json
Copy
Edit
{
  "id": "271ee18ad0884ecebfc3a3cd0069d759",
  "contentType": "Video",
  "createdOn": "2019-12-17T10:27:03.4Z",
  "modifiedOn": "2019-12-17T10:27:03.4Z",
  "status": "Released",
  "title": "My Video Title",
  "tag": "<xml>some tag</xml>",
  "textContent": "Transcript or description",
  ...
}```
